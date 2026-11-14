-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 7: marcar en cada cobro que ya se le pagó a cada parte del reparto.
--
-- El dueño reparte cada cobro entre varias partes y quiere marcar, cobro por cobro, que ya le pagó a cada una. Las
-- liquidaciones (`pay_settlements`) dicen lo que se le pagó a un beneficiario, pero no de qué cobros era. Unas marcas
-- aparte de las liquidaciones podrían contradecir el saldo; por eso cada marca ES una liquidación ligada a sus
-- cobros: `pay_settlement_items` dice de qué cobros es cada liquidación y cuánto de cada uno. El saldo sigue saliendo
-- de las liquidaciones, como siempre: las vistas no cambian.
--
-- Lo que se le debe a una parte en un cobro = su reparto − lo que la pasarela le retuvo en ese cobro − lo ya pagado
-- ligado a ese cobro. Mayor que 0: falta; 0: pagada; menor que 0: se le pagó de más. Los cobros fallidos o en la
-- papelera no tienen nada pendiente. Es la misma cuenta que `payoutStatus` del motor; aquí la usa el filtro
-- «Reparto pendiente» (`pay_payout_pending`).
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000 a 20261115120000
-- (y sus datos), y otra vez encima de sí misma. Crea una tabla, una clave única más en `pay_settlements`, sus
-- disparadores y dos funciones. No cambia ninguna tabla, vista ni función que ya exista: las liquidaciones sin partes
-- (las de siempre, y las que se sigan registrando a mano) quedan igual. No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. Una clave única más en las liquidaciones, para que cada parte apunte a su liquidación Y a su beneficiario: así
--    una parte no puede ser de otro beneficiario que el de su liquidación (clave foránea compuesta, más abajo).
--    `id` ya es único: la clave nueva no cambia qué filas se admiten. Se crea si falta.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pay_settlements_id_beneficiary_uq' and conrelid = 'public.pay_settlements'::regclass
  ) then
    alter table public.pay_settlements
      add constraint pay_settlements_id_beneficiary_uq unique (id, beneficiary_id, user_id);
  end if;
end;
$$;

-- 2. Las partes de una liquidación: de qué cobro es cada una y cuánto (con su signo: negativo es lo que la parte
--    devuelve de ese cobro). Una por cobro en cada liquidación.
--    · Borrar la liquidación borra sus partes (`on delete cascade`).
--    · Borrar del todo un cobro con partes pagadas no se puede (la clave hacia el cobro no lleva cascada): primero se
--      deshacen esos pagos.
create table if not exists public.pay_settlement_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  settlement_id uuid not null,
  transaction_id uuid not null,
  beneficiary_id uuid not null,
  amount numeric(14,2) not null constraint pay_settlement_items_amount_check check (amount <> 0),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint pay_settlement_items_uq unique (settlement_id, transaction_id),
  constraint pay_settlement_items_settlement_fk foreign key (settlement_id, beneficiary_id, user_id)
    references public.pay_settlements (id, beneficiary_id, user_id) on delete cascade,
  constraint pay_settlement_items_transaction_fk foreign key (transaction_id, user_id)
    references public.pay_transactions (id, user_id)
);
create index if not exists pay_settlement_items_transaction_idx on public.pay_settlement_items (transaction_id);
create index if not exists pay_settlement_items_beneficiary_idx on public.pay_settlement_items (beneficiary_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Lo que una liquidación con partes cumple siempre, comprobado al confirmar la transacción (como el reparto,
--    `pay_assert_allocations`):
--      · sus partes suman exactamente su monto (sin partes, es una liquidación de las de siempre);
--      · cada cobro es de la moneda de la liquidación.
--    Que cada parte sea del beneficiario de su liquidación lo defiende la clave foránea compuesta.
--    Las funciones de disparador son SECURITY DEFINER por la misma razón que las de la migración 20261110120000:
--    borrar un usuario corre la cascada con el rol del servicio de Auth.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function private.pay_assert_settlement_items(p_settlement uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_amount numeric(14,2);
  v_currency char(3);
  v_count integer;
  v_sum numeric;
begin
  select s.amount, s.currency into v_amount, v_currency from public.pay_settlements s where s.id = p_settlement;
  if not found then
    return;
  end if;
  select count(*), coalesce(sum(i.amount), 0) into v_count, v_sum
  from public.pay_settlement_items i where i.settlement_id = p_settlement;
  if v_count = 0 then
    return;
  end if;
  if v_sum <> v_amount then
    raise exception 'pay_settlement_items_sum_mismatch: las partes (%) no suman la liquidación (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.pay_settlement_items i
    join public.pay_transactions t on t.id = i.transaction_id
    where i.settlement_id = p_settlement and t.currency <> v_currency
  ) then
    raise exception 'pay_settlement_items_currency_mismatch: un cobro de la liquidación no es en %', v_currency
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.pay_settlement_items_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform private.pay_assert_settlement_items(old.settlement_id);
  end if;
  if tg_op <> 'DELETE' then
    perform private.pay_assert_settlement_items(new.settlement_id);
  end if;
  return null;
end;
$$;

create or replace function private.pay_settlements_items_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.pay_assert_settlement_items(new.id);
  return null;
end;
$$;

-- Si cambia la moneda de un cobro, se vuelven a mirar las liquidaciones que lo pagan.
create or replace function private.pay_transactions_settlement_currency_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settlement uuid;
begin
  for v_settlement in
    select distinct i.settlement_id from public.pay_settlement_items i where i.transaction_id = new.id
  loop
    perform private.pay_assert_settlement_items(v_settlement);
  end loop;
  return null;
end;
$$;

-- `create constraint trigger` no admite `if not exists` ni `or replace`: se crea solo si falta.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pay_settlement_items_check' and tgrelid = 'public.pay_settlement_items'::regclass
  ) then
    create constraint trigger pay_settlement_items_check
      after insert or update or delete on public.pay_settlement_items
      deferrable initially deferred
      for each row execute function private.pay_settlement_items_check();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pay_settlements_items_check' and tgrelid = 'public.pay_settlements'::regclass
  ) then
    create constraint trigger pay_settlements_items_check
      after update on public.pay_settlements
      deferrable initially deferred
      for each row
      when (old.amount is distinct from new.amount or old.currency is distinct from new.currency)
      execute function private.pay_settlements_items_check();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'pay_transactions_settlement_currency_check' and tgrelid = 'public.pay_transactions'::regclass
  ) then
    create constraint trigger pay_transactions_settlement_currency_check
      after update on public.pay_transactions
      deferrable initially deferred
      for each row
      when (old.currency is distinct from new.currency)
      execute function private.pay_transactions_settlement_currency_check();
  end if;
end;
$$;

revoke all on function private.pay_assert_settlement_items(uuid) from public, anon, authenticated;
revoke all on function private.pay_settlement_items_check() from public, anon, authenticated;
revoke all on function private.pay_settlements_items_check() from public, anon, authenticated;
revoke all on function private.pay_transactions_settlement_currency_check() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. RLS, segundo factor y permisos de la tabla nueva: los mismos que `pay_allocations` (se ven, se agregan, se
--    cambian y se borran; solo las propias; con factor verificado, solo en aal2). Cada política se crea si falta.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text := 'pay_settlement_items';
  v_rel regclass := 'public.pay_settlement_items'::regclass;
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
-- 5. pay_record_payouts: crea una o más liquidaciones con sus partes, en una sola transacción (o todas o ninguna).
--    Es idempotente por el id de cada liquidación, como el alta de una liquidación en la app: si ya existe una con
--    ese id y es la misma (beneficiario, fecha, moneda, monto y los mismos cobros con sus montos), se salta; si es
--    otra, no se da por buena (`pay_payout_already_saved`) y no se guarda nada.
--    Las reglas de las partes (que sumen el monto, la moneda de cada cobro, el beneficiario) las comprueban la clave
--    compuesta y los disparadores de arriba.
--   p: { settlements: [{ id, beneficiary_id, paid_on, currency, amount, method?, note?,
--                        items: [{ transaction_id, amount }] }] }
-- Devuelve [{ id, inserted }] en el mismo orden.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.pay_record_payouts(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list jsonb := p -> 'settlements';
  v_item jsonb;
  v_items jsonb;
  v_id uuid;
  v_beneficiary uuid;
  v_count integer;
  v_old public.pay_settlements;
  v_out jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'pay_no_session: hace falta una sesión' using errcode = '28000';
  end if;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then
    raise exception 'pay_bad_payload: se esperaba una lista de liquidaciones' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_list);
  if v_count < 1 or v_count > 200 then
    raise exception 'pay_bad_payload: entre 1 y 200 liquidaciones por llamada (llegaron %)', v_count
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_list) loop
    v_items := v_item -> 'items';
    if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception 'pay_bad_payload: cada liquidación lleva al menos un cobro' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'id')::uuid;
    v_beneficiary := (v_item ->> 'beneficiary_id')::uuid;
    if v_id is null or v_beneficiary is null then
      raise exception 'pay_bad_payload: falta el id o el beneficiario de la liquidación' using errcode = '22023';
    end if;

    select * into v_old from public.pay_settlements s where s.id = v_id;
    if found then
      if v_old.beneficiary_id is distinct from v_beneficiary
        or v_old.paid_on is distinct from (v_item ->> 'paid_on')::date
        or v_old.currency is distinct from (v_item ->> 'currency')
        or v_old.amount is distinct from (v_item ->> 'amount')::numeric
        or (
          select coalesce(jsonb_agg(jsonb_build_array(i.transaction_id, i.amount) order by i.transaction_id), '[]')
          from public.pay_settlement_items i where i.settlement_id = v_id
        ) is distinct from (
          select coalesce(
            jsonb_agg(jsonb_build_array(x.transaction_id, x.amount::numeric(14,2)) order by x.transaction_id), '[]'
          )
          from jsonb_to_recordset(v_items) as x(transaction_id uuid, amount numeric)
        )
      then
        raise exception 'pay_payout_already_saved: la liquidación % ya se había guardado con otros datos', v_id
          using errcode = '23505';
      end if;
      v_out := v_out || jsonb_build_object('id', v_id, 'inserted', false);
      continue;
    end if;

    insert into public.pay_settlements (id, beneficiary_id, paid_on, currency, amount, method, note)
    values (
      v_id,
      v_beneficiary,
      (v_item ->> 'paid_on')::date,
      v_item ->> 'currency',
      (v_item ->> 'amount')::numeric,
      nullif(btrim(v_item ->> 'method'), ''),
      nullif(btrim(v_item ->> 'note'), '')
    );
    insert into public.pay_settlement_items (settlement_id, transaction_id, beneficiary_id, amount)
    select v_id, x.transaction_id, v_beneficiary, x.amount
    from jsonb_to_recordset(v_items) as x(transaction_id uuid, amount numeric);
    v_out := v_out || jsonb_build_object('id', v_id, 'inserted', true);
  end loop;

  return v_out;
end;
$$;

revoke all on function public.pay_record_payouts(jsonb) from public, anon;
grant execute on function public.pay_record_payouts(jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. pay_payout_pending: ¿al reparto de este cobro le queda algo pendiente? Es decir, ¿hay alguna parte a la que le
--    falta algo o a la que se le pagó de más? La misma cuenta que `payoutStatus` del motor:
--      · las partes son quienes están en el reparto y quienes tienen pagos ligados al cobro; quien solo recibe lo
--        retenido sin estar en el reparto no es una parte (lo suyo es un adelanto, no algo pendiente);
--      · lo de cada parte = su reparto − lo retenido − lo pagado; pendiente si no es 0;
--      · un cobro fallido o en la papelera no tiene nada pendiente.
--    Recibe la fila del cobro: la Data API la expone como columna calculada de `pay_transactions`, y con ella se filtra
--    la lista de Cobros («Reparto pendiente»), sus páginas y sus totales, sin traer los cobros al navegador.
--    SECURITY INVOKER: lee con la RLS de quien pregunta.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.pay_payout_pending(t public.pay_transactions)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select t.deleted_at is null and t.status <> 'fallido' and exists (
    select 1
    from (
      select 'reparto' as kind, a.beneficiary_id, a.amount
      from public.pay_allocations a where a.transaction_id = t.id
      union all
      select 'retenido', r.beneficiary_id, -r.amount
      from public.pay_retention_shares r where r.transaction_id = t.id
      union all
      select 'pagado', i.beneficiary_id, -i.amount
      from public.pay_settlement_items i where i.transaction_id = t.id
    ) as x
    group by x.beneficiary_id
    having bool_or(x.kind <> 'retenido') and sum(x.amount) <> 0
  );
$$;

revoke all on function public.pay_payout_pending(public.pay_transactions) from public, anon;
grant execute on function public.pay_payout_pending(public.pay_transactions) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Comprobación final (la de siempre): ninguna tabla pay_ queda sin RLS ni sin la política del segundo factor
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
