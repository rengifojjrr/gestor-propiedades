-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 6: la retención de la pasarela para ciertas personas.
--
-- Una pasarela puede retener un porcentaje de cada cobro durante unos días corridos (p. ej. el 5 % durante 30 días).
-- Lo retenido nunca llega al banco del negocio: cuando se libera, cae en la cuenta de ciertas personas (los
-- titulares de la pasarela), cada una con su porcentaje. Por eso cuenta como un pago que esas personas ya recibieron
-- de lo que les toca en el reparto.
--
-- La retención NO es una comisión: el neto, las comisiones y el reparto no cambian. Es una parte del neto que la
-- pasarela le paga directo a esas personas. Por cobro:
--   · retenido: `retention_amount` (lo calcula la app, al centavo, sobre el bruto vigente; 0 si falló);
--   · lo que llega al banco: `net_amount − retention_amount`;
--   · lo que recibe cada persona: `pay_retention_shares`, que suma exactamente `retention_amount`.
-- La configuración es de la pasarela (`retention_pct`, `retention_days` y sus personas en
-- `pay_gateway_retention_recipients`) y se guarda con `pay_save_gateway_retention`. Cada cobro la congela en su
-- desglose, como las demás reglas de la pasarela.
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000 a 20261114120000
-- (y sus datos). Lo ya guardado queda en 0 (ninguna pasarela retiene, ningún cobro tiene retenido) y da exactamente
-- lo de antes; las vistas conservan sus columnas y su significado, salvo `balance` de `pay_beneficiary_balances`,
-- que ahora descuenta lo retenido (con todo en 0, el mismo número). No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. La retención de la pasarela. Con valor por defecto constante: Postgres no reescribe la tabla y las pasarelas que
--    ya existen quedan sin retener (0 cumple los dos rangos). Cada restricción se crea si falta.
alter table public.pay_gateways
  add column if not exists retention_pct numeric(7,4) not null default 0;

alter table public.pay_gateways
  add column if not exists retention_days integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_gateways_retention_pct_check' and conrelid = 'public.pay_gateways'::regclass
  ) then
    alter table public.pay_gateways
      add constraint pay_gateways_retention_pct_check check (retention_pct >= 0 and retention_pct <= 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_gateways_retention_days_check' and conrelid = 'public.pay_gateways'::regclass
  ) then
    alter table public.pay_gateways
      add constraint pay_gateways_retention_days_check check (retention_days between 0 and 365);
  end if;
end;
$$;

-- 2. A quién le cae lo retenido: una o más personas, cada una con su porcentaje (suman 100; lo comprueba
--    `pay_save_gateway_retention`, que es por donde se guardan).
create table if not exists public.pay_gateway_retention_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  gateway_id uuid not null,
  beneficiary_id uuid not null,
  pct numeric(7,4) not null constraint pay_gateway_retention_recipients_pct_check check (pct > 0 and pct <= 100),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_gateway_retention_recipients_uq unique (gateway_id, beneficiary_id),
  foreign key (gateway_id, user_id) references public.pay_gateways (id, user_id) on delete cascade,
  foreign key (beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index if not exists pay_gateway_retention_recipients_beneficiary_idx
  on public.pay_gateway_retention_recipients (beneficiary_id);

-- 3. Lo retenido de cada cobro. Con valor por defecto constante: los cobros que ya existen quedan en 0, que cumple la
--    restricción (el bruto vigente nunca es negativo). Un fallido tiene el bruto vigente en 0: su retenido también.
alter table public.pay_transactions
  add column if not exists retention_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_transactions_retention_amount_check' and conrelid = 'public.pay_transactions'::regclass
  ) then
    alter table public.pay_transactions
      add constraint pay_transactions_retention_amount_check
        check (retention_amount >= 0 and retention_amount <= gross_amount);
  end if;
end;
$$;

-- 4. Lo que recibe cada persona de lo retenido en un cobro. Suma exactamente `retention_amount` (disparador diferido,
--    como el reparto).
create table if not exists public.pay_retention_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  beneficiary_id uuid not null,
  amount numeric(14,2) not null constraint pay_retention_shares_amount_check check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_retention_shares_uq unique (transaction_id, beneficiary_id),
  foreign key (transaction_id, user_id) references public.pay_transactions (id, user_id) on delete cascade,
  foreign key (beneficiary_id, user_id) references public.pay_beneficiaries (id, user_id)
);
create index if not exists pay_retention_shares_beneficiary_idx on public.pay_retention_shares (beneficiary_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Lo retenido de un cobro suma exactamente sus partes. Se comprueba al confirmar la transacción, igual que el
--    reparto (`pay_assert_allocations`). Las funciones de disparador son SECURITY DEFINER por la misma razón que las
--    de la migración 20261110120000: borrar un usuario corre la cascada con el rol del servicio de Auth.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function private.pay_assert_retention_shares(p_tx uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_retained numeric(14,2);
  v_sum numeric;
begin
  select t.retention_amount into v_retained from public.pay_transactions t where t.id = p_tx;
  if not found then
    return;
  end if;
  select coalesce(sum(s.amount), 0) into v_sum from public.pay_retention_shares s where s.transaction_id = p_tx;
  if v_sum <> v_retained then
    raise exception 'pay_retention_sum_mismatch: las partes de lo retenido (%) no suman lo retenido (%)',
      v_sum, v_retained using errcode = '23514';
  end if;
end;
$$;

create or replace function private.pay_transactions_retention_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.pay_assert_retention_shares(new.id);
  return null;
end;
$$;

create or replace function private.pay_retention_shares_sum_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.pay_assert_retention_shares(old.transaction_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.pay_assert_retention_shares(new.transaction_id);
  end if;
  return null;
end;
$$;

-- `create constraint trigger` no admite `if not exists` ni `or replace`: se crea solo si falta.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pay_transactions_retention_check' and tgrelid = 'public.pay_transactions'::regclass
  ) then
    create constraint trigger pay_transactions_retention_check
      after insert or update on public.pay_transactions
      deferrable initially deferred
      for each row execute function private.pay_transactions_retention_check();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pay_retention_shares_sum_check' and tgrelid = 'public.pay_retention_shares'::regclass
  ) then
    create constraint trigger pay_retention_shares_sum_check
      after insert or update or delete on public.pay_retention_shares
      deferrable initially deferred
      for each row execute function private.pay_retention_shares_sum_check();
  end if;
end;
$$;

revoke all on function private.pay_assert_retention_shares(uuid) from public, anon, authenticated;
revoke all on function private.pay_transactions_retention_check() from public, anon, authenticated;
revoke all on function private.pay_retention_shares_sum_check() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. RLS, segundo factor y permisos de las dos tablas nuevas: los mismos que `pay_allocations` (se ven, se agregan,
--    se cambian y se borran; solo las propias; con factor verificado, solo en aal2). Cada política se crea si falta.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  v_rel regclass;
begin
  foreach t in array array['pay_gateway_retention_recipients', 'pay_retention_shares'] loop
    v_rel := ('public.' || t)::regclass;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    if not exists (select 1 from pg_policy where polname = t || '_mfa' and polrelid = v_rel) then
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated
           using ((select private.pay_mfa_ok())) with check ((select private.pay_mfa_ok()))',
        t || '_mfa', t
      );
    end if;
    if not exists (select 1 from pg_policy where polname = t || '_select' and polrelid = v_rel) then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
        t || '_select', t
      );
    end if;
    if not exists (select 1 from pg_policy where polname = t || '_insert' and polrelid = v_rel) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
        t || '_insert', t
      );
    end if;
    if not exists (select 1 from pg_policy where polname = t || '_update' and polrelid = v_rel) then
      execute format(
        'create policy %I on public.%I for update to authenticated
           using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
        t || '_update', t
      );
    end if;
    if not exists (select 1 from pg_policy where polname = t || '_delete' and polrelid = v_rel) then
      execute format(
        'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
        t || '_delete', t
      );
    end if;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. pay_save_gateway_retention: fija el porcentaje y los días de la retención de una pasarela y reemplaza a sus
--    personas, en una sola transacción. Valida las reglas:
--      · con 0 % no hay personas; con más de 0 % hay al menos una;
--      · cada persona es un beneficiario activo del usuario, una sola vez, y los porcentajes suman exactamente 100.
--    Los rangos (0 a 100 %, 0 a 365 días, cada parte mayor que 0) los defienden las restricciones de las tablas.
--   p: { gateway_id, pct, days, recipients: [{ beneficiary_id, pct }] }
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.pay_save_gateway_retention(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gateway uuid := (p ->> 'gateway_id')::uuid;
  v_pct numeric := coalesce((p ->> 'pct')::numeric, 0);
  v_days integer := coalesce((p ->> 'days')::integer, 0);
  v_recipients jsonb := coalesce(p -> 'recipients', '[]'::jsonb);
  v_count integer;
  v_sum numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'pay_no_session: hace falta una sesión' using errcode = '28000';
  end if;
  if jsonb_typeof(v_recipients) <> 'array' then
    raise exception 'pay_bad_payload: «recipients» debe ser una lista' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_recipients);
  if v_pct = 0 and v_count > 0 then
    raise exception 'pay_retention_recipients_without_pct: sin porcentaje retenido no hay a quién le caiga'
      using errcode = '23514';
  end if;
  if v_pct > 0 and v_count = 0 then
    raise exception 'pay_retention_without_recipients: falta a quién le cae lo retenido' using errcode = '23514';
  end if;
  select coalesce(sum((e.value ->> 'pct')::numeric), 0) into v_sum from jsonb_array_elements(v_recipients) as e(value);
  if v_count > 0 and v_sum <> 100 then
    raise exception 'pay_retention_not_100: las personas suman % %%', v_sum using errcode = '23514';
  end if;
  -- La RLS solo deja ver los propios: uno de otro usuario (o que no existe) cuenta como que falta.
  if exists (
    select 1
    from jsonb_array_elements(v_recipients) as e(value)
    left join public.pay_beneficiaries b on b.id = (e.value ->> 'beneficiary_id')::uuid
    where b.id is null or not b.active
  ) then
    raise exception 'pay_retention_inactive_beneficiary: cada persona tiene que ser un beneficiario activo'
      using errcode = '23514';
  end if;

  update public.pay_gateways g set retention_pct = v_pct, retention_days = v_days where g.id = v_gateway;
  if not found then
    raise exception 'pay_gateway_not_found: no existe la pasarela %', v_gateway using errcode = 'P0002';
  end if;

  delete from public.pay_gateway_retention_recipients r where r.gateway_id = v_gateway;
  insert into public.pay_gateway_retention_recipients (gateway_id, beneficiary_id, pct, sort)
  select
    v_gateway,
    (e.value ->> 'beneficiary_id')::uuid,
    (e.value ->> 'pct')::numeric,
    (e.ordinality - 1)::integer
  from jsonb_array_elements(v_recipients) with ordinality as e(value, ordinality);
end;
$$;

revoke all on function public.pay_save_gateway_retention(jsonb) from public, anon;
grant execute on function public.pay_save_gateway_retention(jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 8. pay_save_transactions: la misma de la migración 20261113120000, más `retention_amount` en lo que inserta y en lo
--    que actualiza, y `retention_shares` igual que `allocations`. Acepta exactamente lo de antes: sin decirlos, un
--    alta queda sin retenido y una actualización no los toca.
--   p_items: [{ mode: 'insert' | 'update', tx: {...columnas...}, expected_updated_at?, allocations?: [...] | null,
--              retention_shares?: [{ beneficiary_id, amount }] | null, event?: { kind, summary, data } }]
--   · En «update», tx solo trae las columnas que cambian (más id). allocations o retention_shares = null o ausente →
--     no se tocan; si vienen, se reemplazan.
--   · p_skip_duplicates: en «insert», si ya existe la referencia en esa pasarela, el cobro se salta (importación).
-- Devuelve [{ id, inserted, skipped }] en el mismo orden. En un cobro saltado, id es el del cobro que ya existe.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

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
          dispute_state, dispute_opened_on, dispute_closed_on, estimated_deposit_on, estimated_deposit_from,
          estimated_is_manual, deposited_on, bank_account_id, fees_paid_by, buyer_fees, retention_amount
        ) values (
          v_id, v_new.occurred_at, v_new.occurred_on, v_new.company_id, v_new.channel_id, v_new.gateway_id,
          v_new.currency, v_new.gross_original, coalesce(v_new.refunded_amount, 0), v_new.gross_amount,
          v_new.fees_total, v_new.net_amount, v_new.alloc_base, coalesce(v_new.alloc_base_amount, 0),
          v_new.breakdown, v_new.fee_version_id, v_new.scheme_id, v_new.scheme_version_id,
          v_reference, v_new.note, coalesce(v_new.status, 'registrado'),
          v_new.dispute_state, v_new.dispute_opened_on, v_new.dispute_closed_on, v_new.estimated_deposit_on,
          v_new.estimated_deposit_from, coalesce(v_new.estimated_is_manual, false), v_new.deposited_on,
          v_new.bank_account_id, coalesce(v_new.fees_paid_by, 'nosotros'), coalesce(v_new.buyer_fees, 0),
          coalesce(v_new.retention_amount, 0)
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
        estimated_deposit_from = v_new.estimated_deposit_from,
        estimated_is_manual = v_new.estimated_is_manual,
        deposited_on = v_new.deposited_on,
        bank_account_id = v_new.bank_account_id,
        deleted_at = v_new.deleted_at,
        fees_paid_by = v_new.fees_paid_by,
        buyer_fees = v_new.buyer_fees,
        retention_amount = v_new.retention_amount
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
      if jsonb_typeof(v_item -> 'retention_shares') = 'array' then
        delete from public.pay_retention_shares s where s.transaction_id = v_id;
        insert into public.pay_retention_shares (transaction_id, beneficiary_id, amount)
        select v_id, x.beneficiary_id, x.amount
        from jsonb_to_recordset(v_item -> 'retention_shares') as x(beneficiary_id uuid, amount numeric);
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

-- `create or replace` conserva los permisos, pero van explícitos igual: no se depende de lo que hubiera.
revoke all on function public.pay_save_transactions(jsonb, boolean) from public, anon;
grant execute on function public.pay_save_transactions(jsonb, boolean) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 9. Las vistas. Cada una parte de su versión vigente (la de la migración 20261110120000 para el saldo de los
--    beneficiarios y los totales por cuenta; la de la 20261113120000 para los totales por empresa y por pasarela).
--    Las columnas de antes conservan nombre, tipo, orden y significado, salvo `balance`; las nuevas van al final.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- El saldo de cada beneficiario: lo asignado, menos lo liquidado, menos lo que la pasarela ya le pagó de lo
-- retenido (`retained`, de los cobros que no están en la papelera ni fallidos). Sigue siendo «lo que se le debe».
-- Quien recibe retención sin estar en el reparto de ese cobro queda con saldo negativo: un adelanto.
create or replace view public.pay_beneficiary_balances
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
),
retenido as (
  select r.user_id, r.beneficiary_id, t.currency, sum(r.amount) as retained
  from public.pay_retention_shares r
  join public.pay_transactions t on t.id = r.transaction_id
  where t.deleted_at is null and t.status <> 'fallido'
  group by r.user_id, r.beneficiary_id, t.currency
)
select
  coalesce(a.user_id, l.user_id, r.user_id) as user_id,
  coalesce(a.beneficiary_id, l.beneficiary_id, r.beneficiary_id) as beneficiary_id,
  coalesce(a.currency, l.currency, r.currency) as currency,
  coalesce(a.assigned, 0)::numeric(16,2) as assigned,
  coalesce(l.settled, 0)::numeric(16,2) as settled,
  (coalesce(a.assigned, 0) - coalesce(l.settled, 0) - coalesce(r.retained, 0))::numeric(16,2) as balance,
  coalesce(r.retained, 0)::numeric(16,2) as retained
from asignado a
full outer join liquidado l
  on l.user_id = a.user_id and l.beneficiary_id = a.beneficiary_id and l.currency = a.currency
full outer join retenido r
  on r.user_id = coalesce(a.user_id, l.user_id)
  and r.beneficiary_id = coalesce(a.beneficiary_id, l.beneficiary_id)
  and r.currency = coalesce(a.currency, l.currency);

create or replace view public.pay_company_totals
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
  max(t.occurred_on) as last_on,
  sum(t.buyer_fees)::numeric(16,2) as buyer_fees,
  sum(t.retention_amount)::numeric(16,2) as retention
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido'
group by t.user_id, t.company_id, t.currency;

create or replace view public.pay_gateway_totals
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
     filter (where t.status = 'depositado'))::numeric(8,2) as median_days,
  sum(t.buyer_fees)::numeric(16,2) as buyer_fees,
  sum(t.retention_amount)::numeric(16,2) as retention
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido'
group by t.user_id, t.gateway_id, t.currency;

-- «Por caer» (pending_*) es lo que se VE como registrado o en tránsito, igual que `isPending` del motor: sin
-- depositar, sin la disputa abierta (la columna puede ser nula) y sin reembolso total (le queda bruto vigente).
-- `deposited_payout` y `pending_payout` son lo mismo que `deposited_net` y `pending_net`, pero con lo que de verdad
-- llega al banco: el neto menos lo retenido.
create or replace view public.pay_bank_account_totals
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
     filter (where t.status = 'depositado'))::numeric(8,2) as median_days,
  coalesce(sum(t.net_amount - t.retention_amount) filter (where t.status = 'depositado'), 0)::numeric(16,2)
    as deposited_payout,
  coalesce(sum(t.net_amount - t.retention_amount) filter (where t.status in ('registrado', 'en_transito')
     and t.gross_amount > 0 and t.dispute_state is distinct from 'abierta'), 0)::numeric(16,2) as pending_payout
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido' and t.bank_account_id is not null
group by t.user_id, t.bank_account_id, t.currency;

-- `create or replace` conserva los permisos y `security_invoker`; los permisos van explícitos igual.
revoke all on public.pay_beneficiary_balances, public.pay_company_totals, public.pay_gateway_totals,
  public.pay_bank_account_totals from public, anon, authenticated;
grant select on public.pay_beneficiary_balances, public.pay_company_totals, public.pay_gateway_totals,
  public.pay_bank_account_totals to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 10. Comprobación final (la de siempre): ninguna tabla pay_ queda sin RLS ni sin la política del segundo factor
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
end;
$$;
