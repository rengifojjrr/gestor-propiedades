-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 4: ¿quién paga la comisión? «Nosotros» o «el comprador», en cada cobro.
--
-- «Nosotros» (lo de siempre): el monto es lo cobrado, la comisión es un costo del negocio y se resta. «Comprador»: al
-- cliente se le cobró de más para cubrir la comisión; el monto es lo que pagó el comprador (1040 por algo de 1000).
-- La comisión se calcula igual, con la tarifa real; pero lo que el comprador pagó de más no es venta del negocio: el
-- reparto va sobre el NETO, aunque el esquema diga «Sobre el bruto», y en los totales esa comisión sale aparte.
--
-- Por cada cobro:
--   · venta del negocio («lo facturado»): el bruto vigente si paga «nosotros»; el neto si paga «comprador»;
--   · comisiones del negocio: las comisiones si paga «nosotros»; 0 si paga «comprador»;
--   · comisiones que pagaron los compradores: 0 si paga «nosotros»; las comisiones si paga «comprador».
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000,
-- 20261111120000 y 20261112120000 (y sus datos). Lo ya guardado queda en «nosotros», y con eso cada total da
-- exactamente lo de antes. No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Quién pagó la comisión. Con valor por defecto constante: Postgres no reescribe la tabla, y los cobros que ya
--    existen quedan en «nosotros».
alter table public.pay_transactions
  add column if not exists fees_paid_by text not null default 'nosotros'
    constraint pay_transactions_fees_paid_by_check check (fees_paid_by in ('nosotros', 'comprador'));

-- 2. Con «comprador» el reparto no va sobre el bruto: lo que el comprador pagó de más no es del negocio. Sin esquema
--    (base vacía) o sobre el neto, entra; `pay_transactions_alloc_base_check` sigue atando la base a su monto. Los
--    cobros que ya existen son de «nosotros» y la cumplen.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_transactions_fees_paid_by_alloc_check'
      and conrelid = 'public.pay_transactions'::regclass
  ) then
    alter table public.pay_transactions
      add constraint pay_transactions_fees_paid_by_alloc_check
        check (fees_paid_by = 'nosotros' or alloc_base is distinct from 'bruto');
  end if;
end;
$$;

-- 3. pay_save_transactions: la misma de la migración 20261112120000, más `fees_paid_by` en lo que inserta y en lo
--    que actualiza. Acepta exactamente lo de antes: sin `fees_paid_by`, un alta queda en «nosotros» y una
--    actualización no lo toca.
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
          estimated_is_manual, deposited_on, bank_account_id, fees_paid_by
        ) values (
          v_id, v_new.occurred_at, v_new.occurred_on, v_new.company_id, v_new.channel_id, v_new.gateway_id,
          v_new.currency, v_new.gross_original, coalesce(v_new.refunded_amount, 0), v_new.gross_amount,
          v_new.fees_total, v_new.net_amount, v_new.alloc_base, coalesce(v_new.alloc_base_amount, 0),
          v_new.breakdown, v_new.fee_version_id, v_new.scheme_id, v_new.scheme_version_id,
          v_reference, v_new.note, coalesce(v_new.status, 'registrado'),
          v_new.dispute_state, v_new.dispute_opened_on, v_new.dispute_closed_on, v_new.estimated_deposit_on,
          v_new.estimated_deposit_from, coalesce(v_new.estimated_is_manual, false), v_new.deposited_on,
          v_new.bank_account_id, coalesce(v_new.fees_paid_by, 'nosotros')
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
        fees_paid_by = v_new.fees_paid_by
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

-- `create or replace` conserva los permisos, pero van explícitos igual: no se depende de lo que hubiera.
revoke all on function public.pay_save_transactions(jsonb, boolean) from public, anon;
grant execute on function public.pay_save_transactions(jsonb, boolean) to authenticated, service_role;

-- 4. Los totales de toda la historia por empresa y por pasarela. Las columnas de antes conservan nombre, tipo y
--    orden: `gross` es lo facturado (la venta del negocio) y `fees`, las comisiones del negocio; `net` no cambia.
--    `buyer_fees`, al final, son las comisiones que pagaron los compradores. Sin cobros de «comprador», `gross` y
--    `fees` son las sumas de siempre y `buyer_fees` es 0. (`pay_bank_account_totals` y `pay_beneficiary_balances`
--    no usan lo facturado ni las comisiones: no cambian.)
create or replace view public.pay_company_totals
with (security_invoker = true) as
select
  t.user_id,
  t.company_id,
  t.currency,
  count(*)::integer as tx_count,
  sum(case when t.fees_paid_by = 'comprador' then t.net_amount else t.gross_amount end)::numeric(16,2) as gross,
  sum(case when t.fees_paid_by = 'comprador' then 0 else t.fees_total end)::numeric(16,2) as fees,
  sum(t.net_amount)::numeric(16,2) as net,
  min(t.occurred_on) as first_on,
  max(t.occurred_on) as last_on,
  sum(case when t.fees_paid_by = 'comprador' then t.fees_total else 0 end)::numeric(16,2) as buyer_fees
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
  sum(case when t.fees_paid_by = 'comprador' then t.net_amount else t.gross_amount end)::numeric(16,2) as gross,
  sum(case when t.fees_paid_by = 'comprador' then 0 else t.fees_total end)::numeric(16,2) as fees,
  sum(t.net_amount)::numeric(16,2) as net,
  (count(*) filter (where t.status = 'depositado'))::integer as deposited_count,
  round(avg(t.deposited_on - t.occurred_on) filter (where t.status = 'depositado'), 2) as avg_days,
  (percentile_cont(0.5) within group (order by (t.deposited_on - t.occurred_on))
     filter (where t.status = 'depositado'))::numeric(8,2) as median_days,
  sum(case when t.fees_paid_by = 'comprador' then t.fees_total else 0 end)::numeric(16,2) as buyer_fees
from public.pay_transactions t
where t.deleted_at is null and t.status <> 'fallido'
group by t.user_id, t.gateway_id, t.currency;

-- `create or replace` conserva los permisos y `security_invoker`; los permisos van explícitos igual.
revoke all on public.pay_company_totals, public.pay_gateway_totals from public, anon, authenticated;
grant select on public.pay_company_totals, public.pay_gateway_totals to authenticated, service_role;

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
