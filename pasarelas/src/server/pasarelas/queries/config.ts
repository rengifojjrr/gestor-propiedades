import "server-only";
import { usBankHolidays } from "@/lib/pasarelas";
import type { PayConfig } from "@/lib/pasarelas";
import {
  BANK_ACCOUNT_COLUMNS,
  BENEFICIARY_COLUMNS,
  CHANNEL_COLUMNS,
  COMPANY_COLUMNS,
  COMPANY_GATEWAY_COLUMNS,
  EXTRA_COLUMNS,
  FEE_VERSION_COLUMNS,
  GATEWAY_COLUMNS,
  HOLIDAY_COLUMNS,
  SCHEME_COLUMNS,
  SCHEME_LINE_COLUMNS,
  SCHEME_VERSION_COLUMNS,
  toPayConfig,
  type Db,
} from "../dto";
import { EXACT_COUNT, readAll as readAllRows, type PageRead } from "./paging";

/** Los años de feriados bancarios que se siembran la primera vez. */
const SEEDED_YEARS = [2026, 2027] as const;

/** Todas las filas de una lectura de configuración (por tramos: `readAll`). */
const readAll = <Row>(page: PageRead<Row>): Promise<Row[]> => readAllRows(page, "de configuración");

/**
 * Toda la configuración del usuario, en la forma que usa el motor. Incluye lo inactivo (cada elemento trae su
 * `active`): un cobro viejo puede apuntar a una empresa o a una opción que ya no se ofrece.
 *
 * Una lectura por tabla, todas a la vez. Las listas salen por nombre; las versiones de tarifa y de esquema, de
 * la más antigua a la más nueva; las opciones de cada pasarela y las líneas de cada versión, en su orden (`sort`).
 * Cada orden termina en una columna única: es estable aunque una tabla se lea en más de un tramo.
 */
export async function loadPayConfig(supabase: Db): Promise<PayConfig> {
  const [
    companies,
    channels,
    gateways,
    feeVersions,
    extras,
    companyGateways,
    bankAccounts,
    beneficiaries,
    schemes,
    schemeVersions,
    schemeLines,
    holidays,
  ] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("pay_companies")
        .select(COMPANY_COLUMNS, EXACT_COUNT)
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_channels")
        .select(CHANNEL_COLUMNS, EXACT_COUNT)
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_gateways")
        .select(GATEWAY_COLUMNS, EXACT_COUNT)
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_gateway_fee_versions")
        .select(FEE_VERSION_COLUMNS, EXACT_COUNT)
        .order("effective_from")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_gateway_extras")
        .select(EXTRA_COLUMNS, EXACT_COUNT)
        .order("sort")
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_company_gateways")
        .select(COMPANY_GATEWAY_COLUMNS, EXACT_COUNT)
        .order("created_at")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_bank_accounts")
        .select(BANK_ACCOUNT_COLUMNS, EXACT_COUNT)
        .order("alias")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_beneficiaries")
        .select(BENEFICIARY_COLUMNS, EXACT_COUNT)
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_schemes")
        .select(SCHEME_COLUMNS, EXACT_COUNT)
        .order("name")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_scheme_versions")
        .select(SCHEME_VERSION_COLUMNS, EXACT_COUNT)
        .order("version")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_scheme_lines")
        .select(SCHEME_LINE_COLUMNS, EXACT_COUNT)
        .order("sort")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_holidays")
        .select(HOLIDAY_COLUMNS, EXACT_COUNT)
        .order("day")
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
  ]);
  return toPayConfig({
    companies,
    channels,
    gateways,
    feeVersions,
    extras,
    companyGateways,
    bankAccounts,
    beneficiaries,
    schemes,
    schemeVersions,
    schemeLines,
    holidays,
  });
}

/**
 * Siembra los feriados bancarios de EE. UU. de 2026 y 2027 si el usuario todavía no tiene ninguno. Si ya tiene
 * alguno (los sembrados, o los que haya puesto o dejado al editar la lista) no hace nada.
 */
export async function ensureHolidays(supabase: Db): Promise<void> {
  const existing = await supabase.from("pay_holidays").select("id").limit(1).throwOnError();
  if (existing.data.length > 0) return;
  const holidays = SEEDED_YEARS.flatMap((year) => usBankHolidays(year));
  // Dos peticiones a la vez pueden llegar aquí las dos: la segunda no duplica ni falla.
  await supabase
    .from("pay_holidays")
    .upsert(holidays, { onConflict: "user_id,day", ignoreDuplicates: true })
    .throwOnError();
}
