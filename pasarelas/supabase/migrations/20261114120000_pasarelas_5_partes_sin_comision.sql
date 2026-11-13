-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Pasarelas 5: partes que no pagan comisión.
--
-- En un cobro cuya comisión pagamos nosotros y cuyo esquema reparte el neto, una parte del reparto puede no pagar
-- comisión (p. ej. el Grupo A): su parte sale del BRUTO, como si no hubiera comisión, y la comisión la cargan las
-- demás, cuyas partes salen del neto. Cada línea de un esquema lleva la marca «No paga comisión» (`fee_exempt`); el
-- «Resto» no es una línea y no se marca. La cuenta la hace la app y la congela en el desglose del cobro; aquí solo
-- se guarda la marca del esquema.
--
-- En `pay_allocations`, la fila de una parte que no paga comisión lleva `base = 'bruto'` y las demás `'neto'`, cada
-- una con el porcentaje del esquema; la suma sigue siendo `alloc_base_amount` (el neto, con `alloc_base = 'neto'`).
-- Las restricciones y los disparadores que ya existen lo admiten tal cual (la base de cada fila es `neto` o `bruto`;
-- el reparto suma la base del cobro), así que no se tocan.
--
-- ADITIVA y repetible: se aplica tal cual sobre la base que ya tiene las migraciones 20261110120000,
-- 20261111120000, 20261112120000 y 20261113120000 (y sus datos). Las líneas que ya existen quedan sin la marca: todo
-- esquema y todo cobro dan lo mismo que antes. No toca nada fuera de lo `pay_` de Pasarelas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- 1. La marca. Con valor por defecto constante: Postgres no reescribe la tabla, y las líneas que ya existen quedan en
--    false. Las líneas no se editan (solo se agregan con su versión), así que no hace falta otra regla.
alter table public.pay_scheme_lines
  add column if not exists fee_exempt boolean not null default false;

-- 2. pay_save_scheme: la misma de la migración 20261110120000 (ninguna posterior la reemplazó), más `fee_exempt` en
--    cada línea. Acepta exactamente lo de antes: una línea que no la dice queda en false.
--   p: { scheme_id?, name, notes?, base?, remainder_beneficiary_id?, effective_from?,
--        lines: [{ beneficiary_id, pct, fee_exempt? }] }
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

  insert into public.pay_scheme_lines (scheme_version_id, beneficiary_id, pct, sort, fee_exempt)
  select
    v_version_id,
    (e.value ->> 'beneficiary_id')::uuid,
    (e.value ->> 'pct')::numeric,
    (e.ordinality - 1)::integer,
    coalesce((e.value ->> 'fee_exempt')::boolean, false)
  from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) with ordinality as e(value, ordinality);

  return jsonb_build_object('scheme_id', v_scheme, 'version_id', v_version_id, 'version', v_version);
end;
$$;

-- `create or replace` conserva los permisos, pero van explícitos igual: no se depende de lo que hubiera.
revoke all on function public.pay_save_scheme(jsonb) from public, anon;
grant execute on function public.pay_save_scheme(jsonb) to authenticated, service_role;
