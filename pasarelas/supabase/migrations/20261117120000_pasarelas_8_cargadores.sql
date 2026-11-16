-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 8: el cargador de cada cobro.
--
-- El dueño trabaja con cargadores: las personas que le traen cada venta. Tiene que reportarle a cada uno sus ventas,
-- así que cada cobro dice (si se sabe) de qué cargador es, y la lista de cobros se filtra y se exporta por cargador.
--
-- El cargador es SOLO para reportar: no cobra del reparto (si se lleva un porcentaje, eso es un beneficiario del
-- esquema). No es una regla, no entra en el desglose ni se congela, y no cambia ninguna cifra: ni montos, ni
-- comisiones, ni repartos, ni vistas.
--   · `pay_loaders`: el catálogo de cargadores del usuario (nombre único sin distinguir mayúsculas ni espacios de
--     más, nota opcional y activo). Uno desactivado no se ofrece al registrar; los cobros que ya lo tienen lo siguen
--     mostrando.
--   · `pay_transactions.loader_id`: el cargador del cobro, opcional. Sin cascada: no se borra un cargador con cobros
--     (primero se desactiva o se le quitan).
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000 a 20261116120000
-- (y sus datos), y otra vez encima de sí misma. Crea una tabla, una columna (nula: los cobros que ya existen quedan
-- sin cargador), su clave, su índice, las políticas de la tabla nueva y vuelve a crear `pay_save_transactions` desde
-- su versión vigente (la de la migración 20261115120000) con el cargador. No toca vistas ni nada fuera de lo `pay_`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Los cargadores. Nombre de 1 a 80 caracteres (sin contar los espacios de los extremos) y nota de hasta 500,
--    como los beneficiarios.
create table if not exists public.pay_loaders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null constraint pay_loaders_name_check check (char_length(btrim(name)) between 1 and 80),
  note text constraint pay_loaders_note_check check (note is null or char_length(note) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pay_loaders_id_user_uq unique (id, user_id)
);

-- 2. Nombre único por usuario, normalizado: sin distinguir mayúsculas, sin los espacios de los extremos y con los de
--    en medio juntados en uno. «Cargador Uno», « cargador uno » y «CARGADOR  UNO» son el mismo: no se
--    distinguirían en la lista ni al importar por nombre. Se crea si falta.
do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'pay_loaders_name_uq'
  ) then
    create unique index pay_loaders_name_uq
      on public.pay_loaders (user_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
  end if;
end;
$$;

-- 3. El cargador de cada cobro. Nula y sin valor por defecto: Postgres no reescribe la tabla y los cobros que ya
--    existen quedan sin cargador.
alter table public.pay_transactions
  add column if not exists loader_id uuid;

-- 4. La clave hacia el cargador, compuesta con `user_id` como las demás (un cobro no puede llevar el cargador de otro
--    usuario) y SIN cascada: borrar un cargador con cobros no se puede. Con su índice, que sirve para filtrar la
--    lista por cargador (y por fecha, como la empresa y la pasarela) y para que la base compruebe la clave al
--    borrar un cargador. Cada una se crea si falta.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_transactions_loader_fk' and conrelid = 'public.pay_transactions'::regclass
  ) then
    alter table public.pay_transactions
      add constraint pay_transactions_loader_fk foreign key (loader_id, user_id)
        references public.pay_loaders (id, user_id);
  end if;
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'pay_transactions_loader_idx'
  ) then
    create index pay_transactions_loader_idx on public.pay_transactions (loader_id, occurred_on desc);
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. RLS, segundo factor y permisos de la tabla nueva: los mismos que `pay_beneficiaries` (se ven, se agregan, se
--    cambian y se borran; solo los propios; con factor verificado, solo en aal2). Cada política se crea si falta.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text := 'pay_loaders';
  v_rel regclass := 'public.pay_loaders'::regclass;
begin
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
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. pay_save_transactions: la misma de la migración 20261115120000, más `loader_id` en lo que inserta y en lo que
--    actualiza, igual que las demás columnas. Acepta exactamente lo de antes: sin decirlo, un alta queda sin
--    cargador y una actualización no lo toca; con `null`, una actualización lo quita.
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
          estimated_is_manual, deposited_on, bank_account_id, fees_paid_by, buyer_fees, retention_amount,
          loader_id
        ) values (
          v_id, v_new.occurred_at, v_new.occurred_on, v_new.company_id, v_new.channel_id, v_new.gateway_id,
          v_new.currency, v_new.gross_original, coalesce(v_new.refunded_amount, 0), v_new.gross_amount,
          v_new.fees_total, v_new.net_amount, v_new.alloc_base, coalesce(v_new.alloc_base_amount, 0),
          v_new.breakdown, v_new.fee_version_id, v_new.scheme_id, v_new.scheme_version_id,
          v_reference, v_new.note, coalesce(v_new.status, 'registrado'),
          v_new.dispute_state, v_new.dispute_opened_on, v_new.dispute_closed_on, v_new.estimated_deposit_on,
          v_new.estimated_deposit_from, coalesce(v_new.estimated_is_manual, false), v_new.deposited_on,
          v_new.bank_account_id, coalesce(v_new.fees_paid_by, 'nosotros'), coalesce(v_new.buyer_fees, 0),
          coalesce(v_new.retention_amount, 0), v_new.loader_id
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
        retention_amount = v_new.retention_amount,
        loader_id = v_new.loader_id
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
-- 7. Comprobación final (la de siempre): ninguna tabla pay_ queda sin RLS, sin la política del segundo factor ni
--    sin su unique (id, user_id)
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
end;
$$;
