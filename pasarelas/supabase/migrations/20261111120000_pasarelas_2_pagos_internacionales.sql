-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 2: pagos internacionales.
--
-- Un pago internacional cuesta la tarifa nacional MÁS un recargo (Stripe suma 1,5 % por tarjeta internacional).
-- El recargo es una opción de la pasarela de un tipo especial, `kind = 'internacional'`: el motor ya sabe aplicar
-- una opción (porcentaje y fijo sobre el bruto), y si la tarifa cambia con «vigente desde», el pago internacional
-- sigue siendo la tarifa del día más el recargo, sin tocar dos tarifas. Al registrar un cobro se pregunta si fue
-- nacional o internacional; «Internacional» agrega esa opción a las que se aplican.
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene la migración 20261110120000 (y sus datos). Las
-- opciones que ya existen quedan como `opcion`. No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. El tipo de cada opción. Con un valor por defecto constante, Postgres no reescribe la tabla.
alter table public.pay_gateway_extras
  add column if not exists kind text not null default 'opcion'
    constraint pay_gateway_extras_kind_check check (kind in ('opcion', 'internacional'));

-- 2. Una sola opción internacional ACTIVA por pasarela. Las apagadas se quedan: los cobros viejos las congelaron.
--    Con user_id en el índice: si fuera solo (gateway_id), quien intentara agregar un recargo a una pasarela ajena
--    recibiría «repetido» (23505) antes que la clave foránea (23503), y sabría que esa pasarela tiene recargo.
create unique index if not exists pay_gateway_extras_internacional_uq
  on public.pay_gateway_extras (gateway_id, user_id)
  where kind = 'internacional' and active;

-- 3. Crea una pasarela con su primera tarifa («desde el inicio») y sus opciones. Igual que la de la migración
--    20261110120000, más el tipo de cada opción (por defecto `opcion`).
--   p: { name, payout_days?, payout_day_type?, refunds_return_fee?, dispute_fee?, notes?,
--        fee: { pct, fixed },
--        extras?: [{ name, pct?, fixed?, base?, default_on?, payout_days_override?, kind? }] }
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

  insert into public.pay_gateway_extras (
    gateway_id, name, pct, fixed, base, default_on, payout_days_override, sort, kind
  )
  select
    v_gateway,
    e.value ->> 'name',
    coalesce((e.value ->> 'pct')::numeric, 0),
    coalesce((e.value ->> 'fixed')::numeric, 0),
    coalesce(e.value ->> 'base', 'bruto'),
    coalesce((e.value ->> 'default_on')::boolean, false),
    (e.value ->> 'payout_days_override')::integer,
    (e.ordinality - 1)::integer,
    coalesce(e.value ->> 'kind', 'opcion')
  from jsonb_array_elements(coalesce(p -> 'extras', '[]'::jsonb)) with ordinality as e(value, ordinality);

  return v_gateway;
end;
$$;

-- `create or replace` conserva los permisos, pero van explícitos igual: no se depende de lo que hubiera.
revoke all on function public.pay_create_gateway(jsonb) from public, anon;
grant execute on function public.pay_create_gateway(jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Comprobación final (la de siempre): ninguna tabla pay_ queda sin RLS ni sin la política del segundo factor
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
