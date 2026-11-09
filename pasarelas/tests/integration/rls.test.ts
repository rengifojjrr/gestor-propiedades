import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  e1Item,
  createUser,
  unwrap,
  enrollTotp,
  expectRejected,
  saveTransactions,
  seedBasics,
  signInAal1,
  type Basics,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Cada fila es de un usuario y solo él la ve y la escribe; y si tiene un segundo factor, solo con sesión aal2.
 * Las mismas comprobaciones se repiten en las 17 tablas y las 4 vistas: los casos salen de las listas de abajo.
 */

/** Estas pruebas recorren las tablas por nombre: usan el mismo cliente, sin los tipos de la base. */
type Cliente = SupabaseClient;
const sinTipos = (client: Db): Cliente => client as unknown as Cliente;

type Fila = Record<string, unknown>;
type Respuesta = { data: unknown; error: { code?: string; message: string } | null };

/** Lo que hace falta para armar una fila válida de un usuario. */
type Contexto = { uid: string; client: Cliente; b: Basics; txId: string };

type Tabla = {
  nombre: string;
  /** Una fila mínima válida y nueva de ese usuario (crea antes lo que la fila necesite). */
  nueva: (ctx: Contexto) => Fila | Promise<Fila>;
  /** Un cambio válido sobre una columna que no es de dinero. */
  cambio: Fila;
};

/** Un texto distinto en cada llamada. Solo letras: la base rechaza un alias con 7 cifras seguidas. */
const sufijo = (): string => Array.from(randomBytes(10), (byte) => String.fromCharCode(97 + (byte % 26))).join("");

let secuencia = 0;
/** Una fecha distinta en cada llamada (para las columnas con unicidad por fecha). */
const fechaUnica = (): string => new Date(Date.UTC(2001, 0, 1 + ++secuencia)).toISOString().slice(0, 10);

async function insertar(client: Cliente, tabla: string, fila: Fila): Promise<string> {
  const creada = unwrap(await client.from(tabla).insert(fila).select("id").single(), `insertar en ${tabla}`);
  return (creada as { id: string }).id;
}

/** Un cobro mínimo sin esquema: su reparto está vacío y su base es cero, así que cuadra. */
const cobroMinimo = (ctx: Contexto): Fila => ({
  occurred_at: "2026-11-02T15:00:00+00:00",
  occurred_on: "2026-11-02",
  company_id: ctx.b.companyId,
  gateway_id: ctx.b.gatewayId,
  currency: "USD",
  gross_original: "10.00",
  gross_amount: "10.00",
  fees_total: "0.00",
  net_amount: "10.00",
  breakdown: { v: 1 },
  fee_version_id: ctx.b.feeVersionId,
});

/** Una versión de esquema sin líneas y con «Resto»: es válida (todo va al «Resto»). */
const versionDeEsquema = (ctx: Contexto): Fila => ({
  scheme_id: ctx.b.schemeId,
  version: 1000 + ++secuencia,
  effective_from: fechaUnica(),
  remainder_beneficiary_id: ctx.b.beneficiaryIds.a,
});

const TABLAS: Tabla[] = [
  { nombre: "pay_bank_accounts", nueva: () => ({ alias: `Cuenta ${sufijo()}` }), cambio: { notes: "cambiada" } },
  { nombre: "pay_beneficiaries", nueva: () => ({ name: `Grupo ${sufijo()}` }), cambio: { notes: "cambiada" } },
  { nombre: "pay_schemes", nueva: () => ({ name: `Esquema ${sufijo()}` }), cambio: { notes: "cambiada" } },
  { nombre: "pay_scheme_versions", nueva: versionDeEsquema, cambio: { base: "bruto" } },
  {
    nombre: "pay_scheme_lines",
    nueva: async (ctx) => ({
      scheme_version_id: await insertar(ctx.client, "pay_scheme_versions", versionDeEsquema(ctx)),
      beneficiary_id: ctx.b.beneficiaryIds.b,
      pct: "10",
    }),
    cambio: { sort: 9 },
  },
  { nombre: "pay_companies", nueva: () => ({ name: `Empresa ${sufijo()}` }), cambio: { notes: "cambiada" } },
  {
    nombre: "pay_channels",
    nueva: (ctx) => ({ company_id: ctx.b.companyId, name: `Canal ${sufijo()}` }),
    cambio: { name: "Canal cambiado" },
  },
  { nombre: "pay_gateways", nueva: () => ({ name: `Pasarela ${sufijo()}` }), cambio: { notes: "cambiada" } },
  {
    nombre: "pay_gateway_fee_versions",
    nueva: (ctx) => ({ gateway_id: ctx.b.gatewayId, pct: "1", fixed: "0.10", effective_from: fechaUnica() }),
    cambio: { note: "cambiada" },
  },
  {
    nombre: "pay_gateway_extras",
    nueva: (ctx) => ({ gateway_id: ctx.b.gatewayId, name: `Opción ${sufijo()}` }),
    cambio: { name: "Opción cambiada" },
  },
  {
    nombre: "pay_company_gateways",
    nueva: async (ctx) => ({
      company_id: await insertar(ctx.client, "pay_companies", { name: `Empresa ${sufijo()}` }),
      gateway_id: ctx.b.gatewayId,
    }),
    cambio: { active: false },
  },
  { nombre: "pay_transactions", nueva: cobroMinimo, cambio: { note: "cambiada" } },
  {
    nombre: "pay_allocations",
    nueva: async (ctx) => ({
      transaction_id: await insertar(ctx.client, "pay_transactions", cobroMinimo(ctx)),
      beneficiary_id: ctx.b.beneficiaryIds.a,
      amount: "0.00",
      base: "neto",
      pct: "0",
    }),
    cambio: { is_remainder: true },
  },
  {
    nombre: "pay_transaction_receipts",
    nueva: (ctx) => ({
      transaction_id: ctx.txId,
      path: `${ctx.uid}/${ctx.txId}/${sufijo()}.png`,
      mime: "image/png",
      size_bytes: 1234,
    }),
    cambio: { original_name: "cambiado.png" },
  },
  {
    nombre: "pay_transaction_events",
    nueva: (ctx) => ({ transaction_id: ctx.txId, kind: "editado", summary: `Evento ${sufijo()}` }),
    cambio: { summary: "cambiado" },
  },
  {
    nombre: "pay_settlements",
    nueva: (ctx) => ({ beneficiary_id: ctx.b.beneficiaryIds.a, paid_on: "2026-11-05", amount: "1.00" }),
    cambio: { note: "cambiada" },
  },
  {
    nombre: "pay_holidays",
    nueva: () => ({ day: fechaUnica(), name: `Feriado ${sufijo()}` }),
    cambio: { name: "Feriado cambiado" },
  },
];

/** Solo se agregan: ni su dueño las edita. Y el historial del cobro tampoco se borra a mano. */
const SIN_EDITAR = ["pay_gateway_fee_versions", "pay_scheme_versions", "pay_scheme_lines", "pay_transaction_events"];
const SIN_BORRAR = ["pay_transaction_events"];

const VISTAS = ["pay_beneficiary_balances", "pay_company_totals", "pay_gateway_totals", "pay_bank_account_totals"];

const admin = sinTipos(adminClient());
const anon = sinTipos(anonClient());

let a: TestUser;
let b: TestUser;
let ctxA: Contexto;
let ctxB: Contexto;
/** A con su factor verificado, pero en una sesión que solo pasó la contraseña. */
let aAal1: Cliente;
/** Una fila de A en cada tabla, creada antes de que A activara su segundo factor. */
const filaDeA: Record<string, string> = {};

async function preparar(user: TestUser): Promise<Contexto> {
  const basics = await seedBasics(user.client);
  const [cobro] = await saveTransactions(user.client, [e1Item(basics)]);
  if (!cobro) throw new Error("pay_save_transactions no devolvió el cobro");
  return { uid: user.id, client: sinTipos(user.client), b: basics, txId: cobro.id };
}

/** Lee con la clave secreta las columnas de `cambio` de una fila (o null si la fila ya no existe). */
async function leerComoAdmin(tabla: Tabla, id: string): Promise<unknown> {
  const columnas = Object.keys(tabla.cambio).join(", ");
  return unwrap(await admin.from(tabla.nombre).select(columnas).eq("id", id), `leer ${tabla.nombre}`)[0] ?? null;
}

/**
 * Un `update` o `delete` que no debe tocar nada: o la base lo rechaza por permisos (42501), o no encuentra filas.
 */
function expectSinEfecto(res: Respuesta): void {
  if (res.error) {
    expect(res.error.code).toBe("42501");
  } else {
    expect(res.data).toEqual([]);
  }
}

/** Intenta cambiar y borrar una fila con `client`, y comprueba con la clave secreta que la fila sigue igual. */
async function expectNoPuedeCambiarNiBorrar(client: Cliente, tabla: Tabla, id: string): Promise<void> {
  const antes = await leerComoAdmin(tabla, id);
  expect(antes).not.toBeNull();

  expectSinEfecto(await client.from(tabla.nombre).update(tabla.cambio).eq("id", id).select("id"));
  expect(await leerComoAdmin(tabla, id)).toEqual(antes);

  expectSinEfecto(await client.from(tabla.nombre).delete().eq("id", id).select("id"));
  expect(await leerComoAdmin(tabla, id)).toEqual(antes);
}

beforeAll(async () => {
  [a, b] = await Promise.all([createUser(), createUser()]);
  [ctxA, ctxB] = await Promise.all([preparar(a), preparar(b)]);

  // A y B todavía no tienen segundo factor: con sesión aal1 trabajan normal. Así nace una fila de A por tabla.
  for (const tabla of TABLAS) {
    filaDeA[tabla.nombre] = await insertar(ctxA.client, tabla.nombre, await tabla.nueva(ctxA));
  }

  // A activa su segundo factor: su sesión queda en aal2. Una entrada nueva solo con contraseña es aal1.
  await enrollTotp(a.client);
  aAal1 = sinTipos(await signInAal1(a.email, a.password));
});

describe.each(TABLAS)("RLS en $nombre", (tabla) => {
  const idDeA = (): string => {
    const id = filaDeA[tabla.nombre];
    if (!id) throw new Error(`No se preparó la fila de A en ${tabla.nombre}`);
    return id;
  };

  it("B no ve las filas de A (ni las de nadie más)", async () => {
    const deA = await ctxB.client.from(tabla.nombre).select("id").eq("id", idDeA());
    expect(deA.error).toBeNull();
    expect(deA.data).toEqual([]);

    const ajenas = await ctxB.client.from(tabla.nombre).select("user_id").neq("user_id", b.id).limit(1);
    expect(ajenas.error).toBeNull();
    expect(ajenas.data).toEqual([]);
  });

  it("B no puede insertar con el user_id de A", async () => {
    const fila = { ...(await tabla.nueva(ctxA)), user_id: a.id };
    expectRejected(await ctxB.client.from(tabla.nombre).insert(fila).select("id"), "42501");
  });

  it("B no puede actualizar ni borrar las filas de A", async () => {
    await expectNoPuedeCambiarNiBorrar(ctxB.client, tabla, idDeA());
  });

  it("anon no ve ni escribe", async () => {
    const lectura = await anon.from(tabla.nombre).select("id").limit(1);
    expectRejected(lectura, "42501");
    expect(lectura.data).toBeNull();

    expectRejected(await anon.from(tabla.nombre).insert(await tabla.nueva(ctxA)).select("id"), "42501");
    await expectNoPuedeCambiarNiBorrar(anon, tabla, idDeA());
  });

  it("A con factor verificado y sesión aal1: no ve nada y no puede escribir", async () => {
    const lectura = await aAal1.from(tabla.nombre).select("id").limit(1);
    expect(lectura.error).toBeNull();
    expect(lectura.data).toEqual([]);

    expectRejected(await aAal1.from(tabla.nombre).insert(await tabla.nueva(ctxA)).select("id"), "42501");
    await expectNoPuedeCambiarNiBorrar(aAal1, tabla, idDeA());
  });

  it("A en aal2 ve lo suyo y escribe", async () => {
    const lectura = await ctxA.client.from(tabla.nombre).select("id, user_id").eq("id", idDeA());
    expect(lectura.error).toBeNull();
    expect(lectura.data).toEqual([{ id: idDeA(), user_id: a.id }]);

    const creada = await ctxA.client.from(tabla.nombre).insert(await tabla.nueva(ctxA)).select("id, user_id").single();
    expect(creada.error).toBeNull();
    expect(creada.data?.user_id).toBe(a.id);
    const id = (creada.data as { id: string }).id;

    if (!SIN_EDITAR.includes(tabla.nombre)) {
      const editada = await ctxA.client.from(tabla.nombre).update(tabla.cambio).eq("id", id).select("id");
      expect(editada.error).toBeNull();
      expect(editada.data).toEqual([{ id }]);
    }
    if (!SIN_BORRAR.includes(tabla.nombre)) {
      const borrada = await ctxA.client.from(tabla.nombre).delete().eq("id", id).select("id");
      expect(borrada.error).toBeNull();
      expect(borrada.data).toEqual([{ id }]);
    }
  });
});

describe.each(VISTAS)("RLS en la vista %s", (vista) => {
  it("A en aal2 ve sus totales, y solo los suyos", async () => {
    const { data, error } = await ctxA.client.from(vista).select("user_id");
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    expect(new Set(data?.map((fila) => (fila as { user_id: string }).user_id))).toEqual(new Set([a.id]));
  });

  it("B no ve totales de A (ni de nadie más)", async () => {
    const ajenas = await ctxB.client.from(vista).select("user_id").neq("user_id", b.id).limit(1);
    expect(ajenas.error).toBeNull();
    expect(ajenas.data).toEqual([]);

    const propias = await ctxB.client.from(vista).select("user_id");
    expect(propias.data?.length).toBeGreaterThan(0);
  });

  it("anon no ve nada", async () => {
    const lectura = await anon.from(vista).select("user_id").limit(1);
    expectRejected(lectura, "42501");
    expect(lectura.data).toBeNull();
  });

  it("A con factor verificado y sesión aal1 no ve nada", async () => {
    const lectura = await aAal1.from(vista).select("user_id").limit(1);
    expect(lectura.error).toBeNull();
    expect(lectura.data).toEqual([]);
  });

  it("nadie escribe en la vista", async () => {
    for (const client of [ctxA.client, ctxB.client, aAal1, anon]) {
      const escritura = await client.from(vista).insert({ user_id: a.id }).select("user_id");
      expect(escritura.error).not.toBeNull();
      expect(escritura.data).toBeNull();
    }
  });
});

describe("el segundo factor también vale para las funciones", () => {
  it("A con factor verificado y sesión aal1 no puede guardar un cobro con pay_save_transactions", async () => {
    const referencia = `aal1-${sufijo()}`;

    const res = await aAal1.rpc("pay_save_transactions", { p_items: [e1Item(ctxA.b, { reference: referencia })] });

    expectRejected(res, "42501");
    const guardados = unwrap(await admin.from("pay_transactions").select("id").eq("reference", referencia), "cobros");
    expect(guardados).toEqual([]);
  });

  it("A en aal2 sí puede", async () => {
    const referencia = `aal2-${sufijo()}`;

    const res = await ctxA.client.rpc("pay_save_transactions", {
      p_items: [e1Item(ctxA.b, { reference: referencia })],
    });

    expect(res.error).toBeNull();
    const guardados = unwrap(await admin.from("pay_transactions").select("id").eq("reference", referencia), "cobros");
    expect(guardados).toHaveLength(1);
  });
});

describe("tablas de solo agregar", () => {
  const tablaPorNombre = (nombre: string): Tabla => {
    const tabla = TABLAS.find((t) => t.nombre === nombre);
    if (!tabla) throw new Error(`Tabla desconocida: ${nombre}`);
    return tabla;
  };

  it.each(SIN_EDITAR)("ni su dueño puede editar una fila de %s", async (nombre) => {
    const tabla = tablaPorNombre(nombre);
    const id = await insertar(ctxA.client, nombre, await tabla.nueva(ctxA));
    const antes = await leerComoAdmin(tabla, id);

    expectSinEfecto(await ctxA.client.from(nombre).update(tabla.cambio).eq("id", id).select("id"));
    expect(await leerComoAdmin(tabla, id)).toEqual(antes);
  });

  it("ni su dueño puede borrar un evento del historial", async () => {
    const tabla = tablaPorNombre("pay_transaction_events");
    const id = await insertar(ctxA.client, tabla.nombre, await tabla.nueva(ctxA));
    const antes = await leerComoAdmin(tabla, id);
    expect(antes).not.toBeNull();

    expectSinEfecto(await ctxA.client.from(tabla.nombre).delete().eq("id", id).select("id"));
    expect(await leerComoAdmin(tabla, id)).toEqual(antes);
  });
});

describe("claves compuestas: una fila no puede apuntar a datos de otro usuario ni de otra empresa", () => {
  it("A no puede crear un canal en una empresa de B", async () => {
    const res = await ctxA.client
      .from("pay_channels")
      .insert({ company_id: ctxB.b.companyId, name: "Canal colado" })
      .select("id");
    expectRejected(res, "23503");

    const enLaEmpresaDeB = unwrap(
      await admin.from("pay_channels").select("name").eq("company_id", ctxB.b.companyId),
      "canales de B",
    );
    expect(enLaEmpresaDeB.map((canal) => (canal as { name: string }).name)).not.toContain("Canal colado");
  });

  it("A no puede crear un cobro con el canal de otra empresa suya", async () => {
    const otraEmpresa = await insertar(ctxA.client, "pay_companies", { name: `Empresa ${sufijo()}` });
    const referencia = `canal-ajeno-${sufijo()}`;
    const res = await ctxA.client
      .from("pay_transactions")
      .insert({ ...cobroMinimo(ctxA), company_id: otraEmpresa, channel_id: ctxA.b.channelId, reference: referencia })
      .select("id");
    expectRejected(res, "23503");

    const guardados = unwrap(await admin.from("pay_transactions").select("id").eq("reference", referencia), "cobros");
    expect(guardados).toEqual([]);
  });

  it("el mismo cobro con el canal de SU empresa sí se guarda", async () => {
    const res = await ctxA.client
      .from("pay_transactions")
      .insert({ ...cobroMinimo(ctxA), channel_id: ctxA.b.channelId })
      .select("channel_id")
      .single();
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ channel_id: ctxA.b.channelId });
  });
});
