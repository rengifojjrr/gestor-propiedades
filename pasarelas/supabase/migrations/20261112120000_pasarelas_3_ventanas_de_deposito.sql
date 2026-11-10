-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 3: ventanas de depósito («de 3 a 5 días hábiles»).
--
-- Las pasarelas no prometen un día sino una ventana. Junto a cada «días al depósito» va un máximo opcional: el de la
-- pasarela, el de cada opción (también el recargo internacional, que es una opción) y el de la cuenta de la pasarela
-- en cada empresa. Vacío = igual al mínimo (un solo día). El cobro guarda la fecha más temprana de su ventana en
-- `estimated_deposit_from` (vacía = la misma que `estimated_deposit_on`); `estimated_deposit_on` sigue siendo la
-- MÁS TARDÍA, así que «por caer», «atrasado», los próximos depósitos y la vista de cuentas siguen con una sola fecha.
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000 y
-- 20261111120000 (y sus datos). Lo ya guardado queda igual: los máximos vacíos y los cobros con su fecha de siempre
-- (`estimated_deposit_from` vacía). No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Los máximos. Cada uno es vacío o va del mínimo a 60, y solo existe si existe su mínimo. Columnas nuevas sin valor
--    por defecto: Postgres no reescribe las tablas (solo comprueba la restricción, que las filas vacías cumplen).
alter table public.pay_gateways
  add column if not exists payout_days_max integer
    constraint pay_gateways_payout_days_max_check
      check (payout_days_max is null or payout_days_max between payout_days and 60);

alter table public.pay_gateway_extras
  add column if not exists payout_days_override_max integer
    constraint pay_gateway_extras_payout_days_override_max_check
      check (
        payout_days_override_max is null
        or (payout_days_override is not null and payout_days_override_max between payout_days_override and 60)
      );

alter table public.pay_company_gateways
  add column if not exists payout_days_override_max integer
    constraint pay_company_gateways_payout_days_override_max_check
      check (
        payout_days_override_max is null
        or (payout_days_override is not null and payout_days_override_max between payout_days_override and 60)
      );

-- 2. La fecha más temprana de la ventana del cobro. Vacía = la misma que la estimada; si no, nunca después de ella
--    (y sin estimada no hay ventana: con «from <= on» a secas, una estimada vacía la dejaría pasar).
alter table public.pay_transactions
  add column if not exists estimated_deposit_from date
    constraint pay_transactions_estimated_window_check
      check (
        estimated_deposit_from is null
        or (estimated_deposit_on is not null and estimated_deposit_from <= estimated_deposit_on)
      );

-- 3. pay_save_transactions: la misma de la migración 20261110120000, más `estimated_deposit_from` en lo que inserta
--    y en lo que actualiza. Acepta exactamente lo de antes: sin `estimated_deposit_from`, un alta la deja vacía y una
--    actualización no la toca.
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
          dispute_state, dispute_opened_on, dispute_closed_on, estimated_deposit_on, estimated_deposit_from,
          estimated_is_manual, deposited_on, bank_account_id
        ) values (
          v_id, v_new.occurred_at, v_new.occurred_on, v_new.company_id, v_new.channel_id, v_new.gateway_id,
          v_new.currency, v_new.gross_original, coalesce(v_new.refunded_amount, 0), v_new.gross_amount,
          v_new.fees_total, v_new.net_amount, v_new.alloc_base, coalesce(v_new.alloc_base_amount, 0),
          v_new.breakdown, v_new.fee_version_id, v_new.scheme_id, v_new.scheme_version_id,
          v_reference, v_new.note, coalesce(v_new.status, 'registrado'),
          v_new.dispute_state, v_new.dispute_opened_on, v_new.dispute_closed_on, v_new.estimated_deposit_on,
          v_new.estimated_deposit_from, coalesce(v_new.estimated_is_manual, false), v_new.deposited_on,
          v_new.bank_account_id
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

-- 4. pay_create_gateway: la misma de la migración 20261111120000 (con el tipo de cada opción), más el máximo de la
--    pasarela y el de cada opción. Sin ellos, como se llamaba antes, quedan vacíos.
--   p: { name, payout_days?, payout_days_max?, payout_day_type?, refunds_return_fee?, dispute_fee?, notes?,
--        fee: { pct, fixed },
--        extras?: [{ name, pct?, fixed?, base?, default_on?, payout_days_override?, payout_days_override_max?,
--                    kind? }] }
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

  insert into public.pay_gateways (
    name, payout_days, payout_days_max, payout_day_type, refunds_return_fee, dispute_fee, notes
  )
  values (
    p ->> 'name',
    coalesce((p ->> 'payout_days')::integer, 2),
    (p ->> 'payout_days_max')::integer,
    coalesce(p ->> 'payout_day_type', 'habiles'),
    coalesce((p ->> 'refunds_return_fee')::boolean, false),
    coalesce((p ->> 'dispute_fee')::numeric, 0),
    p ->> 'notes'
  )
  returning id into v_gateway;

  insert into public.pay_gateway_fee_versions (gateway_id, pct, fixed)
  values (v_gateway, coalesce((p -> 'fee' ->> 'pct')::numeric, 0), coalesce((p -> 'fee' ->> 'fixed')::numeric, 0));

  insert into public.pay_gateway_extras (
    gateway_id, name, pct, fixed, base, default_on, payout_days_override, payout_days_override_max, sort, kind
  )
  select
    v_gateway,
    e.value ->> 'name',
    coalesce((e.value ->> 'pct')::numeric, 0),
    coalesce((e.value ->> 'fixed')::numeric, 0),
    coalesce(e.value ->> 'base', 'bruto'),
    coalesce((e.value ->> 'default_on')::boolean, false),
    (e.value ->> 'payout_days_override')::integer,
    (e.value ->> 'payout_days_override_max')::integer,
    (e.ordinality - 1)::integer,
    coalesce(e.value ->> 'kind', 'opcion')
  from jsonb_array_elements(coalesce(p -> 'extras', '[]'::jsonb)) with ordinality as e(value, ordinality);

  return v_gateway;
end;
$$;

-- `create or replace` conserva los permisos, pero van explícitos igual: no se depende de lo que hubiera.
revoke all on function public.pay_save_transactions(jsonb, boolean) from public, anon;
grant execute on function public.pay_save_transactions(jsonb, boolean) to authenticated, service_role;
revoke all on function public.pay_create_gateway(jsonb) from public, anon;
grant execute on function public.pay_create_gateway(jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Comprobación final (la de siempre): ninguna tabla pay_ queda sin RLS ni sin la política del segundo factor
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
