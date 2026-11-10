-- Las pasarelas de pago: cobros, comisiones, depósitos y repartos.
--
-- Migración ADITIVA. Solo crea objetos con prefijo pay_ en el esquema public, el bucket privado «comprobantes»
-- y sus políticas en storage.objects. No modifica ni borra nada que ya exista.
--
-- Reglas que esta migración hace cumplir en la base (no solo en la app):
--   · Cada fila es de un usuario (user_id) y solo él la ve y la escribe (RLS).
--   · Si el usuario tiene un segundo factor verificado, la sesión debe ser aal2 (política restrictiva).
--   · Una sesión que Auth ya cerró no lee ni escribe, aunque su token todavía no haya caducado.
--   · Una fila no puede apuntar a datos de otro usuario (claves foráneas compuestas con user_id).
--   · Un cobro siempre cuadra: neto = bruto vigente − comisiones, y su reparto suma exactamente su base.
--   · Un esquema de reparto no pasa de 100 % y, si suma menos, tiene que tener «Resto».

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Funciones de apoyo
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Esquema que la Data API no expone: aquí viven las funciones internas (no se pueden llamar por /rest/v1/rpc).
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ¿Sigue abierta la sesión y cumple con el segundo factor? Verdadero si la sesión del token sigue en auth.sessions
-- y, además, es aal2, o es aal1 y el usuario no tiene ningún factor verificado.
--   · Lo segundo es la política oficial de Supabase («MFA solo para quien lo activó») envuelta en una función.
--   · Lo primero cierra la puerta en cuanto Auth cierra la sesión (cambio de contraseña, «cerrar sesión en todos»
--     o en ese dispositivo): Auth borra su fila, pero el token sigue firmado hasta que caduca (1 h) y, sin esto, la
--     RLS lo seguía dejando leer y escribir.
-- SECURITY DEFINER porque el rol authenticated no puede leer auth.mfa_factors (guarda los secretos TOTP) ni
-- auth.sessions: no recibe parámetros y solo responde por la sesión y el usuario del token. Las políticas la llaman
-- como `(select private.pay_mfa_ok())`, que se evalúa una vez por sentencia, no por fila.
create or replace function private.pay_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from auth.sessions as s
      where s.id = (select (auth.jwt() ->> 'session_id')::uuid)
        and s.user_id = (select auth.uid())
    )
    and array[(select auth.jwt() ->> 'aal')] <@ (
      select case when count(f.id) > 0 then array['aal2'] else array['aal1', 'aal2'] end
      from auth.mfa_factors as f
      where f.user_id = (select auth.uid())
        and f.status = 'verified'
    );
$$;

revoke all on function private.pay_mfa_ok() from public, anon;
grant execute on function private.pay_mfa_ok() to authenticated, service_role;

create or replace function private.pay_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Tablas
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Cuenta destino: alias y últimos 4. Nunca el número completo.
create table public.pay_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 80 and alias !~ '[0-9]{7,}'),
  institution text check (institution is null or (char_length(institution) <= 80 and institution !~ '[0-9]{7,}')),
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Beneficiario de un reparto.
create table public.pay_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null default 'persona' check (kind in ('persona', 'empresa', 'cartera')),
  account_alias text check (account_alias is null or (char_length(account_alias) <= 80 and account_alias !~ '[0-9]{7,}')),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
-- Nombre único por usuario, sin distinguir mayúsculas ni espacios de los extremos (igual que empresas y pasarelas):
-- dos beneficiarios con el mismo nombre no se distinguirían en un reparto.
create unique index pay_beneficiaries_name_uq on public.pay_beneficiaries (user_id, lower(btrim(name)));

-- Esquema de reparto. Sus líneas viven en versiones: cambiarlo no toca lo ya repartido.
create table public.pay_schemes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
-- Nombre único por usuario, con la misma regla que el de los beneficiarios.
create unique index pay_schemes_name_uq on public.pay_schemes (user_id, lower(btrim(name)));

create table public.pay_scheme_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scheme_id uuid not null,
  version integer not null check (version >= 1),
  base text not null default 'neto' check (base in ('neto', 'bruto')),
  remainder_beneficiary_id uuid,
  effective_from date not null default date '2000-01-01',
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- Para que el cobro pueda atar su versión a su esquema con una clave foránea compuesta.
  unique (id, scheme_id, user_id),
  unique (scheme_id, version),
  unique (scheme_id, effective_from),
  foreign key (scheme_id, user_id) references public.pay_schemes (id, user_id) on delete cascade,
  foreign key (remainder_beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index pay_scheme_versions_remainder_idx on public.pay_scheme_versions (remainder_beneficiary_id);

create table public.pay_scheme_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scheme_version_id uuid not null,
  beneficiary_id uuid not null,
  pct numeric(7,4) not null check (pct > 0 and pct <= 100),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (scheme_version_id, beneficiary_id),
  foreign key (scheme_version_id, user_id) references public.pay_scheme_versions (id, user_id) on delete cascade,
  foreign key (beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index pay_scheme_lines_beneficiary_idx on public.pay_scheme_lines (beneficiary_id);

-- Empresa.
create table public.pay_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  website text check (website is null or (char_length(website) <= 300 and website ~* '^https?://[^[:space:]]+$')),
  logo_path text check (logo_path is null or char_length(logo_path) <= 300),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  default_scheme_id uuid,
  notes text check (notes is null or char_length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (default_scheme_id, user_id) references public.pay_schemes (id, user_id)
    on delete set null (default_scheme_id)
);
create unique index pay_companies_name_uq on public.pay_companies (user_id, lower(btrim(name)));
create index pay_companies_scheme_idx on public.pay_companies (default_scheme_id);

-- Página o canal de venta, con el costo de su plataforma.
create table public.pay_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  url text check (url is null or (char_length(url) <= 300 and url ~* '^https?://[^[:space:]]+$')),
  platform_fee_pct numeric(7,4) not null default 0 check (platform_fee_pct >= 0 and platform_fee_pct <= 100),
  platform_fee_fixed numeric(14,2) not null default 0 check (platform_fee_fixed >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, company_id, user_id),
  foreign key (company_id, user_id) references public.pay_companies (id, user_id) on delete cascade
);
create index pay_channels_company_idx on public.pay_channels (company_id);

-- Pasarela. Su tarifa vive en versiones con «vigente desde».
create table public.pay_gateways (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  payout_days integer not null default 2 check (payout_days between 0 and 60),
  payout_day_type text not null default 'habiles' check (payout_day_type in ('habiles', 'corridos')),
  refunds_return_fee boolean not null default false,
  dispute_fee numeric(14,2) not null default 0 check (dispute_fee >= 0),
  import_mapping jsonb,
  notes text check (notes is null or char_length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index pay_gateways_name_uq on public.pay_gateways (user_id, lower(btrim(name)));

create table public.pay_gateway_fee_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  gateway_id uuid not null,
  pct numeric(7,4) not null check (pct >= 0 and pct <= 100),
  fixed numeric(14,2) not null check (fixed >= 0),
  effective_from date not null default date '2000-01-01',
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (id, gateway_id, user_id),
  unique (gateway_id, effective_from),
  foreign key (gateway_id, user_id) references public.pay_gateways (id, user_id) on delete cascade
);

-- Opciones de la pasarela (p. ej. «Pago rápido»).
create table public.pay_gateway_extras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  gateway_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  pct numeric(7,4) not null default 0 check (pct >= 0 and pct <= 100),
  fixed numeric(14,2) not null default 0 check (fixed >= 0),
  base text not null default 'bruto' check (base in ('bruto', 'despues_de_comision')),
  default_on boolean not null default false,
  payout_days_override integer check (payout_days_override is null or payout_days_override between 0 and 60),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (gateway_id, user_id) references public.pay_gateways (id, user_id) on delete cascade
);
create index pay_gateway_extras_gateway_idx on public.pay_gateway_extras (gateway_id);

-- La cuenta de una pasarela en una empresa: sus links, su cuenta destino y sus valores propios.
create table public.pay_company_gateways (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company_id uuid not null,
  gateway_id uuid not null,
  dashboard_url text check (dashboard_url is null or (char_length(dashboard_url) <= 300 and dashboard_url ~* '^https?://[^[:space:]]+$')),
  checkout_url text check (checkout_url is null or (char_length(checkout_url) <= 300 and checkout_url ~* '^https?://[^[:space:]]+$')),
  bank_account_id uuid,
  payout_days_override integer check (payout_days_override is null or payout_days_override between 0 and 60),
  default_extra_ids uuid[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (company_id, gateway_id),
  foreign key (company_id, user_id) references public.pay_companies (id, user_id) on delete cascade,
  foreign key (gateway_id, user_id) references public.pay_gateways (id, user_id) on delete cascade,
  foreign key (bank_account_id, user_id) references public.pay_bank_accounts (id, user_id)
    on delete set null (bank_account_id)
);
create index pay_company_gateways_gateway_idx on public.pay_company_gateways (gateway_id);
create index pay_company_gateways_account_idx on public.pay_company_gateways (bank_account_id);

-- El cobro. Lo calculado queda congelado en «breakdown» (con las reglas usadas adentro).
create table public.pay_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null,
  occurred_on date not null,
  company_id uuid not null,
  channel_id uuid,
  gateway_id uuid not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  gross_original numeric(14,2) not null check (gross_original > 0),
  refunded_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  fees_total numeric(14,2) not null check (fees_total >= 0),
  net_amount numeric(14,2) not null,
  -- Con nombre propio: el que Postgres le pondría solo (pay_transactions_alloc_base_check) es el de la
  -- restricción de más abajo, la que ata la base del reparto al cobro.
  alloc_base text constraint pay_transactions_alloc_base_kind_check check (alloc_base in ('neto', 'bruto')),
  alloc_base_amount numeric(14,2) not null default 0,
  breakdown jsonb not null check (jsonb_typeof(breakdown) = 'object'),
  fee_version_id uuid not null,
  scheme_id uuid,
  scheme_version_id uuid,
  -- Siempre recortada: con espacios en los extremos, «abc» y « abc » serían dos referencias y el único de abajo
  -- no vería el duplicado. pay_save_transactions la recorta antes de guardar.
  reference text check (
    reference is null or (reference = btrim(reference) and char_length(reference) between 1 and 120)
  ),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'registrado' check (status in ('registrado', 'en_transito', 'depositado', 'fallido')),
  dispute_state text check (dispute_state in ('abierta', 'ganada', 'perdida')),
  dispute_opened_on date,
  dispute_closed_on date,
  estimated_deposit_on date,
  estimated_is_manual boolean not null default false,
  deposited_on date,
  bank_account_id uuid,
  receipts_count integer not null default 0 check (receipts_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_transactions_refund_range check (refunded_amount >= 0 and refunded_amount <= gross_original),
  constraint pay_transactions_net_check check (net_amount = gross_amount - fees_total),
  -- Fallido: todo en cero (bruto vigente, comisiones y, por la restricción de arriba, neto; también la base del
  -- reparto, para que un cobro fallido no le asigne nada a nadie). Si no, el bruto vigente es lo cobrado menos
  -- lo reembolsado.
  constraint pay_transactions_gross_check check (
    (status = 'fallido' and gross_amount = 0 and fees_total = 0 and alloc_base_amount = 0)
    or (status <> 'fallido' and gross_amount = gross_original - refunded_amount)
  ),
  constraint pay_transactions_deposit_check check ((status = 'depositado') = (deposited_on is not null)),
  constraint pay_transactions_scheme_check check (
    (scheme_version_id is not null and scheme_id is not null and alloc_base is not null)
    or (scheme_version_id is null and alloc_base_amount = 0)
  ),
  -- La base del reparto queda atada al cobro: es su neto o su bruto vigente, según diga alloc_base. Sin esquema
  -- (sin versión) no hay reparto: ni esquema, ni base, y el monto en cero. Así nadie guarda un reparto cuadrado
  -- contra una base inventada. (CASE y no OR: con alloc_base nulo un OR daría nulo y la restricción pasaría.)
  constraint pay_transactions_alloc_base_check check (
    case
      when scheme_version_id is null then scheme_id is null and alloc_base is null and alloc_base_amount = 0
      when alloc_base = 'neto' then alloc_base_amount = net_amount
      when alloc_base = 'bruto' then alloc_base_amount = gross_amount
      else false
    end
  ),
  foreign key (company_id, user_id) references public.pay_companies (id, user_id),
  foreign key (channel_id, company_id, user_id) references public.pay_channels (id, company_id, user_id),
  foreign key (gateway_id, user_id) references public.pay_gateways (id, user_id),
  foreign key (fee_version_id, gateway_id, user_id) references public.pay_gateway_fee_versions (id, gateway_id, user_id),
  foreign key (scheme_id, user_id) references public.pay_schemes (id, user_id),
  -- La versión tiene que ser de ESE esquema (y de ese usuario): no vale el esquema de uno con la versión de otro.
  -- Con versión siempre hay esquema (pay_transactions_scheme_check), así que la clave siempre se comprueba.
  foreign key (scheme_version_id, scheme_id, user_id) references public.pay_scheme_versions (id, scheme_id, user_id),
  foreign key (bank_account_id, user_id) references public.pay_bank_accounts (id, user_id)
    on delete set null (bank_account_id)
);
create unique index pay_transactions_reference_uq on public.pay_transactions (user_id, gateway_id, reference)
  where reference is not null;
create index pay_transactions_user_date_idx on public.pay_transactions (user_id, occurred_on desc, occurred_at desc);
create index pay_transactions_company_idx on public.pay_transactions (company_id, occurred_on desc);
create index pay_transactions_gateway_idx on public.pay_transactions (gateway_id, occurred_on desc);
create index pay_transactions_channel_idx on public.pay_transactions (channel_id);
create index pay_transactions_account_idx on public.pay_transactions (bank_account_id);
create index pay_transactions_fee_version_idx on public.pay_transactions (fee_version_id);
create index pay_transactions_scheme_idx on public.pay_transactions (scheme_id);
create index pay_transactions_scheme_version_idx on public.pay_transactions (scheme_version_id);
create index pay_transactions_pending_idx on public.pay_transactions (user_id, estimated_deposit_on)
  where status in ('registrado', 'en_transito') and deleted_at is null;
create index pay_transactions_trash_idx on public.pay_transactions (user_id, deleted_at) where deleted_at is not null;

-- Lo que le toca a cada beneficiario de cada cobro.
create table public.pay_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  beneficiary_id uuid not null,
  amount numeric(14,2) not null,
  base text not null check (base in ('neto', 'bruto')),
  pct numeric(7,4) not null check (pct >= 0 and pct <= 100),
  is_remainder boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (transaction_id, beneficiary_id),
  foreign key (transaction_id, user_id) references public.pay_transactions (id, user_id) on delete cascade,
  foreign key (beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index pay_allocations_beneficiary_idx on public.pay_allocations (beneficiary_id);

-- Comprobantes del cobro (el archivo está en Storage, bucket privado «comprobantes»).
create table public.pay_transaction_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_transaction_receipts_path_check check (
    path like user_id::text || '/' || transaction_id::text || '/%' and char_length(path) <= 300
  ),
  foreign key (transaction_id, user_id) references public.pay_transactions (id, user_id) on delete cascade
);
create index pay_transaction_receipts_tx_idx on public.pay_transaction_receipts (transaction_id);

-- Historial del cobro. Solo se agrega.
create table public.pay_transaction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'creado', 'importado', 'editado', 'reembolso', 'disputa_abierta', 'disputa_ganada', 'disputa_perdida',
    -- El evento de una disputa que se anula. Lo escribe la app; aquí solo se admite el valor.
    'disputa_anulada',
    'recalculado', 'en_transito', 'depositado', 'deposito_revertido', 'fallido', 'reabierto', 'fecha_estimada',
    'a_papelera', 'restaurado', 'comprobante_agregado', 'comprobante_quitado'
  )),
  summary text not null check (char_length(summary) between 1 and 300),
  data jsonb,
  unique (id, user_id),
  foreign key (transaction_id, user_id) references public.pay_transactions (id, user_id) on delete cascade
);
create index pay_transaction_events_tx_idx on public.pay_transaction_events (transaction_id, at desc);

-- Liquidaciones: lo que ya se le pagó a un beneficiario (negativo = lo que devolvió).
create table public.pay_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  beneficiary_id uuid not null,
  paid_on date not null,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,2) not null check (amount <> 0),
  method text check (method is null or char_length(method) <= 60),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 300),
  receipt_mime text check (receipt_mime is null or receipt_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  receipt_size integer check (receipt_size is null or (receipt_size > 0 and receipt_size <= 10485760)),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_settlements_receipt_folder_check check (
    receipt_path is null or receipt_path like user_id::text || '/' || id::text || '/%'
  ),
  foreign key (beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index pay_settlements_beneficiary_idx on public.pay_settlements (beneficiary_id, paid_on desc);

-- Feriados (días sin movimiento bancario). Los siembra la app por usuario y son editables.
create table public.pay_holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, day)
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Disparadores
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'pay_bank_accounts', 'pay_beneficiaries', 'pay_schemes', 'pay_companies', 'pay_channels', 'pay_gateways',
    'pay_gateway_extras', 'pay_company_gateways', 'pay_settlements'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.pay_touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end;
$$;

-- receipts_count no se escribe a mano: solo lo mueve el disparador de los comprobantes (más abajo). Una sentencia
-- directa sobre el cobro —de la app, de la API o de pay_save_transactions— corre este disparador con
-- pg_trigger_depth() = 1: ahí una inserción empieza en 0 y un update conserva el valor que había, diga lo que
-- diga la sentencia. La actualización que hace pay_receipts_count_sync nace dentro de otro disparador (nivel 2 o
-- más) y pasa sin tocar.
-- El nombre importa: los disparadores BEFORE de una tabla corren por orden alfabético y este tiene que ir ANTES
-- que pay_transactions_touch, para que su condición compare el contador ya restaurado (un update que cambia una
-- nota y de paso intenta tocar el contador sigue contando como edición y mueve updated_at).
create or replace function private.pay_transactions_receipts_count_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' then
      new.receipts_count := 0;
    else
      new.receipts_count := old.receipts_count;
    end if;
  end if;
  return new;
end;
$$;

create trigger pay_transactions_receipts_count_guard
  before insert or update on public.pay_transactions
  for each row execute function private.pay_transactions_receipts_count_guard();

-- En el cobro, sumar o quitar un comprobante no cuenta como edición (no mueve updated_at).
create trigger pay_transactions_touch
  before update on public.pay_transactions
  for each row
  when (old.receipts_count = new.receipts_count)
  execute function private.pay_touch_updated_at();

-- Las cinco funciones de disparador que siguen son SECURITY DEFINER. Un disparador AFTER corre con el rol de quien
-- lanzó la sentencia, y cuando se borra un usuario por la API de Auth (o desde el panel) ese rol es el del
-- servicio de Auth: no tiene permisos sobre las tablas pay_ ni sobre el esquema private, y el borrado en cascada
-- fallaba en estos disparadores. Con SECURITY DEFINER corren como el dueño de las tablas, borre quien borre.
-- No abren nada: no reciben parámetros, no se pueden llamar a mano (nadie tiene permiso de ejecución), llevan
-- search_path vacío y solo miran la fila que disparó —que ya pasó la RLS y está atada a su dueño por la clave
-- foránea compuesta con user_id—: comprueban y lanzan, o ajustan el contador del cobro de ese mismo usuario.
create or replace function private.pay_receipts_count_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.pay_transactions set receipts_count = receipts_count + 1
    where id = new.transaction_id and user_id = new.user_id;
    return new;
  end if;
  update public.pay_transactions set receipts_count = greatest(receipts_count - 1, 0)
  where id = old.transaction_id and user_id = old.user_id;
  return old;
end;
$$;

create trigger pay_transaction_receipts_count
  after insert or delete on public.pay_transaction_receipts
  for each row execute function private.pay_receipts_count_sync();

-- El reparto de un cobro suma exactamente su base. Se comprueba al confirmar la transacción.
create or replace function private.pay_assert_allocations(p_tx uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_base numeric(14,2);
  v_sum numeric;
begin
  select t.alloc_base_amount into v_base from public.pay_transactions t where t.id = p_tx;
  if not found then
    return;
  end if;
  select coalesce(sum(a.amount), 0) into v_sum from public.pay_allocations a where a.transaction_id = p_tx;
  if v_sum <> v_base then
    raise exception 'pay_alloc_sum_mismatch: el reparto (%) no suma su base (%)', v_sum, v_base
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.pay_transactions_alloc_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.pay_assert_allocations(new.id);
  return null;
end;
$$;

create constraint trigger pay_transactions_alloc_check
  after insert or update on public.pay_transactions
  deferrable initially deferred
  for each row execute function private.pay_transactions_alloc_check();

create or replace function private.pay_allocations_sum_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.pay_assert_allocations(old.transaction_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.pay_assert_allocations(new.transaction_id);
  end if;
  return null;
end;
$$;

create constraint trigger pay_allocations_sum_check
  after insert or update or delete on public.pay_allocations
  deferrable initially deferred
  for each row execute function private.pay_allocations_sum_check();

-- Un esquema válido: no pasa de 100 %; si suma menos, tiene «Resto»; el «Resto» no es además una línea.
create or replace function private.pay_assert_scheme_version(p_version uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_remainder uuid;
  v_sum numeric;
begin
  select v.remainder_beneficiary_id into v_remainder from public.pay_scheme_versions v where v.id = p_version;
  if not found then
    return;
  end if;
  select coalesce(sum(l.pct), 0) into v_sum from public.pay_scheme_lines l where l.scheme_version_id = p_version;
  if v_sum > 100 then
    raise exception 'pay_scheme_over_100: las líneas suman % %%', v_sum using errcode = '23514';
  end if;
  if v_sum < 100 and v_remainder is null then
    raise exception 'pay_scheme_under_100: las líneas suman % %% y no hay «Resto»', v_sum using errcode = '23514';
  end if;
  if v_remainder is not null and exists (
    select 1 from public.pay_scheme_lines l where l.scheme_version_id = p_version and l.beneficiary_id = v_remainder
  ) then
    raise exception 'pay_scheme_remainder_in_lines: el «Resto» no puede ser además una línea' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.pay_scheme_versions_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.pay_assert_scheme_version(new.id);
  return null;
end;
$$;

create constraint trigger pay_scheme_versions_check
  after insert or update on public.pay_scheme_versions
  deferrable initially deferred
  for each row execute function private.pay_scheme_versions_check();

create or replace function private.pay_scheme_lines_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.pay_assert_scheme_version(old.scheme_version_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.pay_assert_scheme_version(new.scheme_version_id);
  end if;
  return null;
end;
$$;

create constraint trigger pay_scheme_lines_check
  after insert or update or delete on public.pay_scheme_lines
  deferrable initially deferred
  for each row execute function private.pay_scheme_lines_check();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Seguridad por fila (RLS) y segundo factor
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  todas text[] := array[
    'pay_bank_accounts', 'pay_beneficiaries', 'pay_schemes', 'pay_scheme_versions', 'pay_scheme_lines',
    'pay_companies', 'pay_channels', 'pay_gateways', 'pay_gateway_fee_versions', 'pay_gateway_extras',
    'pay_company_gateways', 'pay_transactions', 'pay_allocations', 'pay_transaction_receipts',
    'pay_transaction_events', 'pay_settlements', 'pay_holidays'
  ];
  -- Solo se agregan (y se borran si nada las usa): nunca se editan.
  sin_editar text[] := array['pay_gateway_fee_versions', 'pay_scheme_versions', 'pay_scheme_lines'];
  -- Solo se agregan: ni se editan ni se borran a mano (se van con su cobro).
  solo_agregar text[] := array['pay_transaction_events'];
begin
  foreach t in array todas loop
    execute format('alter table public.%I enable row level security', t);
    -- Permisos explícitos: no se depende de los GRANT por defecto del proyecto.
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    if t = any (solo_agregar) then
      execute format('grant select, insert on table public.%I to authenticated', t);
    elsif t = any (sin_editar) then
      execute format('grant select, insert, delete on table public.%I to authenticated', t);
    else
      execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    end if;

    -- Restrictiva: con segundo factor verificado, la sesión tiene que ser aal2. Aplica a todo.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((select private.pay_mfa_ok())) with check ((select private.pay_mfa_ok()))',
      t || '_mfa', t
    );

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert', t
    );
    if not (t = any (sin_editar) or t = any (solo_agregar)) then
      execute format(
        'create policy %I on public.%I for update to authenticated
           using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
        t || '_update', t
      );
    end if;
    if not (t = any (solo_agregar)) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
        t || '_delete', t
      );
    end if;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Vistas de totales de toda la historia (respetan RLS: security_invoker)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create view public.pay_beneficiary_balances
with (security_invoker = true) as
with asignado as (
  select a.user_id, a.beneficiary_id, t.currency, sum(a.amount) as assigned
  from public.pay_allocations a
  join public.pay_transactions t on t.id = a.transaction_id
  -- Ni la papelera ni los fallidos: un cobro fallido no le asigna nada a nadie, aunque traiga repartos (que
  -- solo pueden sumar cero), igual que no cuenta en los demás totales.
  where t.deleted_at is null and t.status <> 'fallido'
  group by a.user_id, a.beneficiary_id, t.currency
),
liquidado as (
  select s.user_id, s.beneficiary_id, s.currency, sum(s.amount) as settled
  from public.pay_settlements s
  group by s.user_id, s.beneficiary_id, s.currency
)
select
  coalesce(a.user_id, l.user_id) as user_id,
  coalesce(a.beneficiary_id, l.beneficiary_id) as beneficiary_id,
  coalesce(a.currency, l.currency) as currency,
  coalesce(a.assigned, 0)::numeric(16,2) as assigned,
  coalesce(l.settled, 0)::numeric(16,2) as settled,
  (coalesce(a.assigned, 0) - coalesce(l.settled, 0))::numeric(16,2) as balance
from asignado a
full outer join liquidado l
  on l.user_id = a.user_id and l.beneficiary_id = a.beneficiary_id and l.currency = a.currency;

create view public.pay_company_totals
with (security_invoker = true) as
select
  t.user_id,
  t.company_id,
  t.currency,
  count(*)::integer as tx_count,
  sum(t.gross_amount)::numeric(16,2) as gross,
  sum(t.fees_total)::numeric(16,2) as fees,
  sum(t.net_amount)::numeric(16,2) as net,
  min(t.occurred_on) as first_on,
  max(t.occurred_on) as last_on
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido'
group by t.user_id, t.company_id, t.currency;

create view public.pay_gateway_totals
with (security_invoker = true) as
select
  t.user_id,
  t.gateway_id,
  t.currency,
  count(*)::integer as tx_count,
  sum(t.gross_amount)::numeric(16,2) as gross,
  sum(t.fees_total)::numeric(16,2) as fees,
  sum(t.net_amount)::numeric(16,2) as net,
  (count(*) filter (where t.status = 'depositado'))::integer as deposited_count,
  round(avg(t.deposited_on - t.occurred_on) filter (where t.status = 'depositado'), 2) as avg_days,
  (percentile_cont(0.5) within group (order by (t.deposited_on - t.occurred_on))
     filter (where t.status = 'depositado'))::numeric(8,2) as median_days
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido'
group by t.user_id, t.gateway_id, t.currency;

-- «Por caer» (pending_*) es lo que se VE como registrado o en tránsito, igual que `isPending` del motor: sin
-- depositar, sin la disputa abierta (la columna puede ser nula) y sin reembolso total (le queda bruto vigente).
create view public.pay_bank_account_totals
with (security_invoker = true) as
select
  t.user_id,
  t.bank_account_id,
  t.currency,
  (count(*) filter (where t.status = 'depositado'))::integer as deposited_count,
  coalesce(sum(t.net_amount) filter (where t.status = 'depositado'), 0)::numeric(16,2) as deposited_net,
  (count(*) filter (where t.status in ('registrado', 'en_transito') and t.gross_amount > 0
     and t.dispute_state is distinct from 'abierta'))::integer as pending_count,
  coalesce(sum(t.net_amount) filter (where t.status in ('registrado', 'en_transito') and t.gross_amount > 0
     and t.dispute_state is distinct from 'abierta'), 0)::numeric(16,2) as pending_net,
  round(avg(t.deposited_on - t.occurred_on) filter (where t.status = 'depositado'), 2) as avg_days,
  (percentile_cont(0.5) within group (order by (t.deposited_on - t.occurred_on))
     filter (where t.status = 'depositado'))::numeric(8,2) as median_days
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido' and t.bank_account_id is not null
group by t.user_id, t.bank_account_id, t.currency;

revoke all on public.pay_beneficiary_balances, public.pay_company_totals, public.pay_gateway_totals,
  public.pay_bank_account_totals from public, anon, authenticated;
grant select on public.pay_beneficiary_balances, public.pay_company_totals, public.pay_gateway_totals,
  public.pay_bank_account_totals to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Escrituras de varias tablas en una sola transacción (security invoker: RLS sigue aplicando)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Crea o actualiza de 1 a 500 cobros, cada uno con su reparto y su evento de historial.
--   p_items: [{ mode: 'insert' | 'update', tx: {...columnas...}, expected_updated_at?, allocations?: [...] | null,
--              event?: { kind, summary, data } }]
--   · En «update», tx solo trae las columnas que cambian (más id). allocations = null o ausente → no se tocan.
--   · p_skip_duplicates: en «insert», si ya existe la referencia en esa pasarela, el cobro se salta (importación).
-- Devuelve [{ id, inserted, skipped }] en el mismo orden. En un cobro saltado, id es el del cobro que ya existe.
create or replace function public.pay_save_transactions(p_items jsonb, p_skip_duplicates boolean default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_tx jsonb;
  v_mode text;
  v_id uuid;
  v_expected timestamptz;
  v_old public.pay_transactions;
  v_new public.pay_transactions;
  v_reference text;
  v_existing uuid;
  v_inserted boolean;
  v_skipped boolean;
  v_count integer;
  v_out jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'pay_no_session: hace falta una sesión' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'pay_bad_payload: se esperaba una lista de cobros' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 500 then
    raise exception 'pay_bad_payload: entre 1 y 500 cobros por llamada (llegaron %)', v_count using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_mode := v_item ->> 'mode';
    v_tx := v_item -> 'tx';
    if v_tx is null or jsonb_typeof(v_tx) <> 'object' then
      raise exception 'pay_bad_payload: falta «tx»' using errcode = '22023';
    end if;
    v_inserted := false;
    v_skipped := false;

    if v_mode = 'insert' then
      v_new := jsonb_populate_record(null::public.pay_transactions, v_tx);
      -- La referencia se guarda sin espacios alrededor, y así mismo se compara para saber si ya existe.
      v_reference := nullif(btrim(v_new.reference), '');
      v_existing := null;
      if p_skip_duplicates and v_reference is not null then
        -- A lo sumo hay uno: la referencia es única por usuario y pasarela, y la RLS solo deja ver los propios.
        select t.id into v_existing
        from public.pay_transactions t
        where t.gateway_id = v_new.gateway_id and t.reference = v_reference;
      end if;
      if v_existing is not null then
        -- Duplicado saltado: se devuelve el id del cobro que ya existe, para que quien importa sepa cuál es.
        v_id := v_existing;
        v_skipped := true;
      else
        v_id := coalesce(v_new.id, gen_random_uuid());
        insert into public.pay_transactions (
          id, occurred_at, occurred_on, company_id, channel_id, gateway_id, currency,
          gross_original, refunded_amount, gross_amount, fees_total, net_amount, alloc_base, alloc_base_amount,
          breakdown, fee_version_id, scheme_id, scheme_version_id, reference, note, status,
          dispute_state, dispute_opened_on, dispute_closed_on, estimated_deposit_on, estimated_is_manual,
          deposited_on, bank_account_id
        ) values (
          v_id, v_new.occurred_at, v_new.occurred_on, v_new.company_id, v_new.channel_id, v_new.gateway_id,
          v_new.currency, v_new.gross_original, coalesce(v_new.refunded_amount, 0), v_new.gross_amount,
          v_new.fees_total, v_new.net_amount, v_new.alloc_base, coalesce(v_new.alloc_base_amount, 0),
          v_new.breakdown, v_new.fee_version_id, v_new.scheme_id, v_new.scheme_version_id,
          v_reference, v_new.note, coalesce(v_new.status, 'registrado'),
          v_new.dispute_state, v_new.dispute_opened_on, v_new.dispute_closed_on, v_new.estimated_deposit_on,
          coalesce(v_new.estimated_is_manual, false), v_new.deposited_on, v_new.bank_account_id
        );
        v_inserted := true;
      end if;

    elsif v_mode = 'update' then
      v_id := (v_tx ->> 'id')::uuid;
      select * into v_old from public.pay_transactions t where t.id = v_id for update;
      if not found then
        raise exception 'pay_tx_not_found: no existe el cobro %', v_id using errcode = 'P0002';
      end if;
      v_expected := (v_item ->> 'expected_updated_at')::timestamptz;
      if v_expected is not null and v_old.updated_at <> v_expected then
        raise exception 'pay_tx_conflict: el cobro % cambió mientras lo editabas', v_id using errcode = '40001';
      end if;
      v_new := jsonb_populate_record(
        v_old, v_tx - 'id' - 'user_id' - 'created_at' - 'updated_at' - 'receipts_count'
      );
      update public.pay_transactions t set
        occurred_at = v_new.occurred_at,
        occurred_on = v_new.occurred_on,
        company_id = v_new.company_id,
        channel_id = v_new.channel_id,
        gateway_id = v_new.gateway_id,
        currency = v_new.currency,
        gross_original = v_new.gross_original,
        refunded_amount = v_new.refunded_amount,
        gross_amount = v_new.gross_amount,
        fees_total = v_new.fees_total,
        net_amount = v_new.net_amount,
        alloc_base = v_new.alloc_base,
        alloc_base_amount = v_new.alloc_base_amount,
        breakdown = v_new.breakdown,
        fee_version_id = v_new.fee_version_id,
        scheme_id = v_new.scheme_id,
        scheme_version_id = v_new.scheme_version_id,
        reference = nullif(btrim(v_new.reference), ''),
        note = v_new.note,
        status = v_new.status,
        dispute_state = v_new.dispute_state,
        dispute_opened_on = v_new.dispute_opened_on,
        dispute_closed_on = v_new.dispute_closed_on,
        estimated_deposit_on = v_new.estimated_deposit_on,
        estimated_is_manual = v_new.estimated_is_manual,
        deposited_on = v_new.deposited_on,
        bank_account_id = v_new.bank_account_id,
        deleted_at = v_new.deleted_at
      where t.id = v_id;

    else
      raise exception 'pay_bad_payload: modo desconocido «%»', coalesce(v_mode, '') using errcode = '22023';
    end if;

    if not v_skipped then
      if jsonb_typeof(v_item -> 'allocations') = 'array' then
        delete from public.pay_allocations a where a.transaction_id = v_id;
        insert into public.pay_allocations (transaction_id, beneficiary_id, amount, base, pct, is_remainder)
        select v_id, x.beneficiary_id, x.amount, x.base, x.pct, coalesce(x.is_remainder, false)
        from jsonb_to_recordset(v_item -> 'allocations')
          as x(beneficiary_id uuid, amount numeric, base text, pct numeric, is_remainder boolean);
      end if;
      if jsonb_typeof(v_item -> 'event') = 'object' then
        insert into public.pay_transaction_events (transaction_id, kind, summary, data)
        values (
          v_id,
          v_item -> 'event' ->> 'kind',
          left(coalesce(nullif(btrim(v_item -> 'event' ->> 'summary'), ''), v_item -> 'event' ->> 'kind'), 300),
          v_item -> 'event' -> 'data'
        );
      end if;
    end if;

    v_out := v_out || jsonb_build_object('id', v_id, 'inserted', v_inserted, 'skipped', v_skipped);
  end loop;

  return v_out;
end;
$$;

-- Crea el esquema si hace falta (scheme_id nulo) y le agrega una versión con sus líneas.
--   p: { scheme_id?, name, notes?, base?, remainder_beneficiary_id?, effective_from?, lines: [{ beneficiary_id, pct }] }
-- Si ya hay una versión con esa misma «vigente desde» y ningún cobro la usa, se reemplaza.
-- Devuelve { scheme_id, version_id, version }.
create or replace function public.pay_save_scheme(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scheme uuid := (p ->> 'scheme_id')::uuid;
  v_from date := coalesce((p ->> 'effective_from')::date, date '2000-01-01');
  v_existing uuid;
  v_version integer;
  v_version_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'pay_no_session: hace falta una sesión' using errcode = '28000';
  end if;
  if jsonb_typeof(coalesce(p -> 'lines', '[]'::jsonb)) <> 'array' then
    raise exception 'pay_bad_payload: «lines» debe ser una lista' using errcode = '22023';
  end if;

  if v_scheme is null then
    insert into public.pay_schemes (name, notes)
    values (p ->> 'name', p ->> 'notes')
    returning id into v_scheme;
  else
    update public.pay_schemes s set
      name = coalesce(p ->> 'name', s.name),
      notes = case when p ? 'notes' then p ->> 'notes' else s.notes end
    where s.id = v_scheme;
    if not found then
      raise exception 'pay_scheme_not_found: no existe el esquema %', v_scheme using errcode = 'P0002';
    end if;
  end if;

  select v.id into v_existing
  from public.pay_scheme_versions v
  where v.scheme_id = v_scheme and v.effective_from = v_from;
  if v_existing is not null then
    if exists (select 1 from public.pay_transactions t where t.scheme_version_id = v_existing) then
      raise exception 'pay_scheme_version_in_use: ya hay cobros con la versión vigente desde %', v_from
        using errcode = '23503';
    end if;
    delete from public.pay_scheme_versions v where v.id = v_existing;
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version
  from public.pay_scheme_versions v
  where v.scheme_id = v_scheme;

  insert into public.pay_scheme_versions (scheme_id, version, base, remainder_beneficiary_id, effective_from)
  values (
    v_scheme, v_version, coalesce(p ->> 'base', 'neto'), (p ->> 'remainder_beneficiary_id')::uuid, v_from
  )
  returning id into v_version_id;

  insert into public.pay_scheme_lines (scheme_version_id, beneficiary_id, pct, sort)
  select v_version_id, (e.value ->> 'beneficiary_id')::uuid, (e.value ->> 'pct')::numeric, (e.ordinality - 1)::integer
  from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) with ordinality as e(value, ordinality);

  return jsonb_build_object('scheme_id', v_scheme, 'version_id', v_version_id, 'version', v_version);
end;
$$;

-- Crea una pasarela con su primera tarifa («desde el inicio») y sus opciones.
--   p: { name, payout_days?, payout_day_type?, refunds_return_fee?, dispute_fee?, notes?,
--        fee: { pct, fixed }, extras?: [{ name, pct?, fixed?, base?, default_on?, payout_days_override? }] }
-- Devuelve el id de la pasarela.
create or replace function public.pay_create_gateway(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gateway uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'pay_no_session: hace falta una sesión' using errcode = '28000';
  end if;
  if jsonb_typeof(p -> 'fee') is distinct from 'object' then
    raise exception 'pay_bad_payload: falta «fee»' using errcode = '22023';
  end if;

  insert into public.pay_gateways (name, payout_days, payout_day_type, refunds_return_fee, dispute_fee, notes)
  values (
    p ->> 'name',
    coalesce((p ->> 'payout_days')::integer, 2),
    coalesce(p ->> 'payout_day_type', 'habiles'),
    coalesce((p ->> 'refunds_return_fee')::boolean, false),
    coalesce((p ->> 'dispute_fee')::numeric, 0),
    p ->> 'notes'
  )
  returning id into v_gateway;

  insert into public.pay_gateway_fee_versions (gateway_id, pct, fixed)
  values (v_gateway, coalesce((p -> 'fee' ->> 'pct')::numeric, 0), coalesce((p -> 'fee' ->> 'fixed')::numeric, 0));

  insert into public.pay_gateway_extras (gateway_id, name, pct, fixed, base, default_on, payout_days_override, sort)
  select
    v_gateway,
    e.value ->> 'name',
    coalesce((e.value ->> 'pct')::numeric, 0),
    coalesce((e.value ->> 'fixed')::numeric, 0),
    coalesce(e.value ->> 'base', 'bruto'),
    coalesce((e.value ->> 'default_on')::boolean, false),
    (e.value ->> 'payout_days_override')::integer,
    (e.ordinality - 1)::integer
  from jsonb_array_elements(coalesce(p -> 'extras', '[]'::jsonb)) with ordinality as e(value, ordinality);

  return v_gateway;
end;
$$;

revoke all on function public.pay_save_transactions(jsonb, boolean) from public, anon;
revoke all on function public.pay_save_scheme(jsonb) from public, anon;
revoke all on function public.pay_create_gateway(jsonb) from public, anon;
grant execute on function public.pay_save_transactions(jsonb, boolean) to authenticated, service_role;
grant execute on function public.pay_save_scheme(jsonb) to authenticated, service_role;
grant execute on function public.pay_create_gateway(jsonb) to authenticated, service_role;

-- Funciones internas (esquema private): nadie necesita permiso de ejecución sobre ellas. Las de disparador las
-- lanza la base, y las de comprobación solo las llaman esos disparadores, que corren como el dueño de las tablas
-- (SECURITY DEFINER, ver la sección 3).
revoke all on function private.pay_touch_updated_at() from public, anon, authenticated;
revoke all on function private.pay_transactions_receipts_count_guard() from public, anon, authenticated;
revoke all on function private.pay_receipts_count_sync() from public, anon, authenticated;
revoke all on function private.pay_transactions_alloc_check() from public, anon, authenticated;
revoke all on function private.pay_allocations_sum_check() from public, anon, authenticated;
revoke all on function private.pay_scheme_versions_check() from public, anon, authenticated;
revoke all on function private.pay_scheme_lines_check() from public, anon, authenticated;
revoke all on function private.pay_assert_allocations(uuid) from public, anon, authenticated;
revoke all on function private.pay_assert_scheme_version(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Storage: bucket privado «comprobantes»
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes', 'comprobantes', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets b where b.id = 'comprobantes' and b.public) then
    raise exception 'Ya existe un bucket «comprobantes» y es público: no se pueden guardar comprobantes ahí';
  end if;
end;
$$;

-- Cada usuario solo ve y escribe dentro de su carpeta «{user_id}/…», con la misma regla de segundo factor.
create policy pay_comprobantes_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.pay_mfa_ok())
  );

create policy pay_comprobantes_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.pay_mfa_ok())
  );

create policy pay_comprobantes_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.pay_mfa_ok())
  )
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.pay_mfa_ok())
  );

create policy pay_comprobantes_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.pay_mfa_ok())
  );

-- Las de arriba son permisivas, y las permisivas se suman con OR: si el proyecto ya tiene otra política de
-- storage.objects sin filtro de bucket (como las de los ejemplos de la documentación), dejaría entrar a
-- «comprobantes» sin el segundo factor. Estas dos son RESTRICTIVAS y solo miran «comprobantes»: los demás buckets
-- quedan como estaban.
-- Van aparte para authenticated y para anon: anon no puede ejecutar pay_mfa_ok() (y no le hace falta: no entra).
create policy pay_comprobantes_mfa on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id is distinct from 'comprobantes'
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and (select private.pay_mfa_ok())
    )
  )
  with check (
    bucket_id is distinct from 'comprobantes'
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and (select private.pay_mfa_ok())
    )
  );

create policy pay_comprobantes_anon on storage.objects
  as restrictive for all to anon
  using (bucket_id is distinct from 'comprobantes')
  with check (bucket_id is distinct from 'comprobantes');

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 8. Comprobación final: ninguna tabla pay_ queda sin RLS, sin la política del segundo factor ni sin su
--    unique (id, user_id), y el bucket «comprobantes» tiene sus políticas restrictivas
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pay\_%'
    and (
      not c.relrowsecurity
      or not exists (
        select 1 from pg_policy p where p.polrelid = c.oid and not p.polpermissive
      )
    );
  if v_missing is not null then
    raise exception 'Tablas pay_ sin RLS o sin política de segundo factor: %', v_missing;
  end if;

  select string_agg(c.relname, ', ') into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pay\_%'
    and not exists (
      select 1
      from pg_constraint k
      where k.conrelid = c.oid and k.contype = 'u'
        and (
          select array_agg(a.attname::text order by a.attname::text)
          from pg_attribute a
          where a.attrelid = c.oid and a.attnum = any (k.conkey)
        ) = array['id', 'user_id']
    );
  if v_missing is not null then
    raise exception 'Tablas pay_ sin unique (id, user_id): %', v_missing;
  end if;

  -- «comprobantes» con su restrictiva para authenticated y para anon (ver la sección 7).
  select string_agg(r.rolname, ', ') into v_missing
  from pg_roles r
  where r.rolname in ('authenticated', 'anon')
    and not exists (
      select 1
      from pg_policy p
      where p.polrelid = 'storage.objects'::regclass
        and not p.polpermissive
        and p.polcmd = '*'
        and r.oid = any (p.polroles)
        and pg_get_expr(p.polqual, p.polrelid) like '%comprobantes%'
        and pg_get_expr(p.polwithcheck, p.polrelid) like '%comprobantes%'
    );
  if v_missing is not null then
    raise exception 'storage.objects sin la política restrictiva de «comprobantes» para: %', v_missing;
  end if;
end;
$$;
