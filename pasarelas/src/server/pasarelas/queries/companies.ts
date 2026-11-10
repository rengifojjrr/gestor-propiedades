import "server-only";
import { dec, normPct, toMoney } from "@/lib/pasarelas";
import type { Currency, ISODate, Money, Pct } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { RECEIPTS_BUCKET } from "../ops/receipts";
import { zId } from "../zod";
import { readAll } from "./paging";

/**
 * Las lecturas de la pantalla Empresas: la lista, la ficha de una empresa (con sus canales, sus cuentas de pasarela
 * y lo facturado en toda su historia, de la vista `pay_company_totals`) y las URL firmadas de los logos.
 * Dinero y porcentajes se piden con `::text` y salen canónicos ("0.25", "3"), como en `dto.ts`.
 */

// ─── Lo que se pide ─────────────────────────────────────────────────────────────────────────────────────────

const COMPANY_LIST_COLUMNS = "id, name, website, logo_path, currency, active";
const COMPANY_DETAIL_COLUMNS = `${COMPANY_LIST_COLUMNS}, default_scheme_id, notes`;
const CHANNEL_DETAIL_COLUMNS = "id, name, url, platform_fee_pct::text, platform_fee_fixed::text, active";
const COMPANY_GATEWAY_DETAIL_COLUMNS =
  "id, gateway_id, dashboard_url, checkout_url, bank_account_id, payout_days_override, default_extra_ids, active";
const COMPANY_TOTAL_COLUMNS = "company_id, currency, tx_count, gross::text, fees::text, net::text, first_on, last_on";

/** Lo que dura la URL firmada de un logo: se genera al pintar la pantalla y no se guarda. */
const LOGO_URL_SECONDS = 60;

// ─── Lo que llega ───────────────────────────────────────────────────────────────────────────────────────────

type CompanyListRow = {
  id: string;
  name: string;
  website: string | null;
  logo_path: string | null;
  currency: string;
  active: boolean;
};
type ChannelDetailRow = {
  id: string;
  name: string;
  url: string | null;
  platform_fee_pct: string;
  platform_fee_fixed: string;
  active: boolean;
};
type CompanyGatewayDetailRow = {
  id: string;
  gateway_id: string;
  dashboard_url: string | null;
  checkout_url: string | null;
  bank_account_id: string | null;
  payout_days_override: number | null;
  default_extra_ids: string[] | null;
  active: boolean;
};
type CompanyTotalRow = {
  company_id: string | null;
  currency: string | null;
  tx_count: number | null;
  gross: string | null;
  fees: string | null;
  net: string | null;
  first_on: string | null;
  last_on: string | null;
};

// ─── Lo que se entrega ──────────────────────────────────────────────────────────────────────────────────────

/** Lo facturado por una empresa en UNA moneda, en toda su historia (sin papelera ni fallidos). */
export type CompanyTotal = {
  currency: Currency;
  count: number;
  gross: Money;
  fees: Money;
  net: Money;
  firstOn: ISODate;
  lastOn: ISODate;
};

export type CompanyListItem = {
  id: string;
  name: string;
  website: string | null;
  logoPath: string | null;
  currency: Currency;
  active: boolean;
  /** Por moneda, en orden de moneda. Vacío si no tiene cobros. */
  totals: CompanyTotal[];
};

export type CompanyChannel = {
  id: string;
  name: string;
  url: string | null;
  platformFeePct: Pct;
  platformFeeFixed: Money;
  active: boolean;
};

/** La cuenta de una pasarela en la empresa. El nombre de la pasarela, de la cuenta y de las opciones, con `PayConfig`. */
export type CompanyGateway = {
  id: string;
  gatewayId: string;
  dashboardUrl: string | null;
  checkoutUrl: string | null;
  bankAccountId: string | null;
  payoutDaysOverride: number | null;
  defaultExtraIds: string[] | null;
  active: boolean;
};

export type CompanyDetail = Omit<CompanyListItem, "totals"> & {
  defaultSchemeId: string | null;
  notes: string | null;
  channels: CompanyChannel[];
  gateways: CompanyGateway[];
  totals: CompanyTotal[];
};

// ─── Mapeadores ─────────────────────────────────────────────────────────────────────────────────────────────

const money = (value: string | number | null): Money => toMoney(dec(String(value ?? 0)));

function toCompanyTotal(row: CompanyTotalRow): CompanyTotal {
  if (row.currency === null || row.first_on === null || row.last_on === null) {
    throw new RangeError("Una fila de pay_company_totals llegó sin moneda o sin fechas");
  }
  return {
    currency: row.currency,
    count: row.tx_count ?? 0,
    gross: money(row.gross),
    fees: money(row.fees),
    net: money(row.net),
    firstOn: row.first_on,
    lastOn: row.last_on,
  };
}

const byCurrency = (a: CompanyTotal, b: CompanyTotal): number =>
  a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;

function toListItem(row: CompanyListRow, totals: CompanyTotal[]): CompanyListItem {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    logoPath: row.logo_path,
    currency: row.currency,
    active: row.active,
    totals: [...totals].sort(byCurrency),
  };
}

function toChannel(row: ChannelDetailRow): CompanyChannel {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    platformFeePct: normPct(row.platform_fee_pct),
    platformFeeFixed: money(row.platform_fee_fixed),
    active: row.active,
  };
}

function toCompanyGateway(row: CompanyGatewayDetailRow): CompanyGateway {
  return {
    id: row.id,
    gatewayId: row.gateway_id,
    dashboardUrl: row.dashboard_url,
    checkoutUrl: row.checkout_url,
    bankAccountId: row.bank_account_id,
    payoutDaysOverride: row.payout_days_override,
    defaultExtraIds: row.default_extra_ids,
    active: row.active,
  };
}

// ─── Lecturas ───────────────────────────────────────────────────────────────────────────────────────────────

/** Las empresas del usuario por nombre (también las inactivas), cada una con lo facturado en total por moneda. */
export async function listCompanies(supabase: Db): Promise<CompanyListItem[]> {
  const [companies, totals] = await Promise.all([
    readAll(
      (from, to) =>
        supabase
          .from("pay_companies")
          .select(COMPANY_LIST_COLUMNS, { count: "exact" })
          .order("name")
          .order("id")
          .range(from, to)
          .throwOnError(),
      "de empresas",
    ),
    readAll(
      (from, to) =>
        supabase
          .from("pay_company_totals")
          .select(COMPANY_TOTAL_COLUMNS, { count: "exact" })
          .order("company_id")
          .order("currency")
          .range(from, to)
          .throwOnError(),
      "de empresas",
    ),
  ]);
  const byCompany = new Map<string, CompanyTotal[]>();
  for (const row of totals) {
    if (row.company_id === null) continue;
    const list = byCompany.get(row.company_id) ?? [];
    list.push(toCompanyTotal(row));
    byCompany.set(row.company_id, list);
  }
  return companies.map((row) => toListItem(row, byCompany.get(row.id) ?? []));
}

/**
 * La ficha de una empresa: sus datos, sus canales (por nombre), sus cuentas de pasarela (en el orden en que se
 * agregaron) y lo facturado en total por moneda. `null` si no existe, si es de otro usuario o si el id no es un uuid.
 */
export async function getCompany(supabase: Db, id: string): Promise<CompanyDetail | null> {
  const companyId = zId.safeParse(id).data;
  if (companyId === undefined) return null;
  const [company, channels, gateways, totals] = await Promise.all([
    supabase.from("pay_companies").select(COMPANY_DETAIL_COLUMNS).eq("id", companyId).maybeSingle().throwOnError(),
    supabase
      .from("pay_channels")
      .select(CHANNEL_DETAIL_COLUMNS)
      .eq("company_id", companyId)
      .order("name")
      .order("id")
      .throwOnError(),
    supabase
      .from("pay_company_gateways")
      .select(COMPANY_GATEWAY_DETAIL_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at")
      .order("id")
      .throwOnError(),
    supabase.from("pay_company_totals").select(COMPANY_TOTAL_COLUMNS).eq("company_id", companyId).throwOnError(),
  ]);
  const row = company.data;
  if (row === null) return null;
  return {
    ...toListItem(row, totals.data.map(toCompanyTotal)),
    defaultSchemeId: row.default_scheme_id,
    notes: row.notes,
    channels: channels.data.map(toChannel),
    gateways: gateways.data.map(toCompanyGateway),
  };
}

/**
 * URL firmadas de 60 segundos para pintar los logos, por ruta. Se generan al pintar la pantalla y no se guardan.
 * Un logo que no se puede firmar (el archivo ya no está) no trae URL: la pantalla pinta las iniciales.
 */
export async function companyLogoUrls(supabase: Db, paths: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths)];
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrls(wanted, LOGO_URL_SECONDS);
  if (error) throw error;
  const urls = new Map<string, string>();
  for (const item of data) {
    if (item.error === null && item.path !== null && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
