import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { UserError, errorMessage } from "@/server/pasarelas/errors";
import {
  deleteChannel,
  deleteCompany,
  deleteCompanyGateway,
  saveChannel,
  saveCompany,
  saveCompanyGateway,
  setCompanyActive,
  setCompanyLogo,
} from "@/server/pasarelas/ops/companies";
import { companyLogoUrls, getCompany, listCompanies } from "@/server/pasarelas/queries/companies";
import {
  adminClient,
  createUser,
  e1Item,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type TestUser,
} from "./helpers";

/**
 * Empresas, sus canales y sus cuentas de pasarela: cada operación de `ops/companies.ts` con la sesión real de un
 * usuario de prueba (la clave secreta solo prepara o inspecciona), y las lecturas de `queries/companies.ts`.
 */

const BUCKET = "comprobantes";
/** Los primeros bytes de un PNG: a Storage le basta el tipo declarado. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const IN_USE = "Tiene cobros: desactívala en su lugar";
const CHANNEL_IN_USE = "Tiene cobros: desactívalo en su lugar";
const REPEATED_GATEWAY = "Esa pasarela ya está en esta empresa";

const admin = adminClient();

let user: TestUser;
let other: TestUser;
let b: Basics;

/** Lo que lanzó `fn`: falla si no lanzó. */
async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("debió lanzar");
}

/** Comprueba que `fn` lanza un `UserError` con ese mensaje. */
async function expectUserError(fn: () => Promise<unknown>, message: string): Promise<void> {
  const error = await thrown(fn);
  expect(error).toBeInstanceOf(UserError);
  expect((error as UserError).message).toBe(message);
}

/** Los archivos de una carpeta del bucket, vistos con la clave secreta. */
async function filesIn(folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  return data.map((file) => `${folder}/${file.name}`).sort();
}

/** Sube un archivo a la carpeta de la empresa con la sesión del usuario. Devuelve su ruta. */
async function uploadLogo(companyId: string, body: Buffer = PNG, contentType = "image/png"): Promise<string> {
  const extension = contentType === "application/pdf" ? "pdf" : "png";
  const path = `${user.id}/${companyId}/${randomUUID()}.${extension}`;
  const { error } = await user.client.storage.from(BUCKET).upload(path, body, { contentType });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
  return path;
}

async function companyRow(id: string) {
  return (
    await admin
      .from("pay_companies")
      .select("name, website, logo_path, currency, default_scheme_id, notes, active")
      .eq("id", id)
      .maybeSingle()
  ).data;
}

/** Una empresa nueva, sin nada, con un nombre único. */
async function newCompany(name = `Tienda Demo ${randomUUID().slice(0, 8)}`): Promise<string> {
  return saveCompany(user.client, { name, website: null, currency: "USD", defaultSchemeId: null, notes: null });
}

beforeAll(async () => {
  [user, other] = await Promise.all([createUser(), createUser()]);
  b = await seedBasics(user.client);
});

describe("saveCompany", () => {
  it("crea la empresa con su web, su moneda, su esquema por defecto y sus notas", async () => {
    const id = await saveCompany(user.client, {
      name: "Tienda Demo",
      website: "https://tienda.example.com",
      currency: "USD",
      defaultSchemeId: b.schemeId,
      notes: "Ventas en línea",
    });

    expect(await companyRow(id)).toEqual({
      name: "Tienda Demo",
      website: "https://tienda.example.com",
      logo_path: null,
      currency: "USD",
      default_scheme_id: b.schemeId,
      notes: "Ventas en línea",
      active: true,
    });
  });

  it("con `id` edita la empresa que ya existe", async () => {
    const id = await newCompany();

    const saved = await saveCompany(user.client, {
      id,
      name: "Estudio Demo",
      website: "http://estudio.example.com",
      currency: "MXN",
      defaultSchemeId: null,
      notes: null,
    });

    expect(saved).toBe(id);
    expect(await companyRow(id)).toMatchObject({
      name: "Estudio Demo",
      website: "http://estudio.example.com",
      currency: "MXN",
    });
  });

  it("un nombre repetido (sin distinguir mayúsculas) da su mensaje", async () => {
    const error = await thrown(() => newCompany("escuela demo"));
    expect(errorMessage(error)).toBe("Ya hay una empresa con ese nombre.");
  });

  it("editar una empresa que no existe, o que es de otro usuario, no toca nada", async () => {
    const message = "Esa empresa ya no existe.";
    const input = { name: "Otra Demo", website: null, currency: "USD", defaultSchemeId: null, notes: null };
    await expectUserError(() => saveCompany(user.client, { id: randomUUID(), ...input }), message);
    await expectUserError(() => saveCompany(other.client, { id: b.companyId, ...input }), message);
    expect(await companyRow(b.companyId)).toMatchObject({ name: "Escuela Demo" });
  });
});

describe("setCompanyActive", () => {
  it("desactiva y vuelve a activar", async () => {
    const id = await newCompany();

    await setCompanyActive(user.client, id, false);
    expect(await companyRow(id)).toMatchObject({ active: false });

    await setCompanyActive(user.client, id, true);
    expect(await companyRow(id)).toMatchObject({ active: true });
  });

  it("la de otro usuario no existe", async () => {
    await expectUserError(() => setCompanyActive(other.client, b.companyId, false), "Esa empresa ya no existe.");
    expect(await companyRow(b.companyId)).toMatchObject({ active: true });
  });
});

describe("saveChannel y deleteChannel", () => {
  it("crea el canal con su costo como texto exacto y lo edita", async () => {
    const companyId = await newCompany();

    const id = await saveChannel(user.client, {
      companyId,
      name: "Tienda en línea",
      url: "https://tienda.example.com/checkout",
      platformFeePct: "3",
      platformFeeFixed: "0.25",
      active: true,
    });
    const created = (await getCompany(user.client, companyId))?.channels;
    expect(created).toEqual([
      {
        id,
        name: "Tienda en línea",
        url: "https://tienda.example.com/checkout",
        platformFeePct: "3",
        platformFeeFixed: "0.25",
        active: true,
      },
    ]);

    await saveChannel(user.client, {
      id,
      companyId,
      name: "Mercado Demo",
      url: null,
      platformFeePct: "12.5",
      platformFeeFixed: "0.00",
      active: false,
    });
    expect((await getCompany(user.client, companyId))?.channels).toEqual([
      { id, name: "Mercado Demo", url: null, platformFeePct: "12.5", platformFeeFixed: "0.00", active: false },
    ]);
  });

  it("editar un canal desde otra empresa no lo mueve: no existe ahí", async () => {
    const companyId = await newCompany();
    await expectUserError(
      () =>
        saveChannel(user.client, {
          id: b.channelId,
          companyId,
          name: "Robado",
          url: null,
          platformFeePct: "0",
          platformFeeFixed: "0.00",
          active: true,
        }),
      "Ese canal ya no existe.",
    );
  });

  it("un canal sin cobros se borra; uno con cobros, no", async () => {
    const companyId = await newCompany();
    const id = await saveChannel(user.client, {
      companyId,
      name: "Feria Demo",
      url: null,
      platformFeePct: "0",
      platformFeeFixed: "0.00",
      active: true,
    });

    await deleteChannel(user.client, id);
    expect((await getCompany(user.client, companyId))?.channels).toEqual([]);

    await saveTransactions(user.client, [e1Item(b)]);
    await expectUserError(() => deleteChannel(user.client, b.channelId), CHANNEL_IN_USE);
    expect((await getCompany(user.client, b.companyId))?.channels.map((channel) => channel.id)).toEqual([b.channelId]);
  });

  it("borrar un canal que no existe lo dice", async () => {
    await expectUserError(() => deleteChannel(user.client, randomUUID()), "Ese canal ya no existe.");
    await expectUserError(() => deleteChannel(other.client, b.channelId), "Ese canal ya no existe.");
  });
});

describe("saveCompanyGateway y deleteCompanyGateway", () => {
  it("agrega la cuenta de la pasarela con sus links, su cuenta destino, sus días y sus opciones", async () => {
    const companyId = await newCompany();

    const id = await saveCompanyGateway(user.client, {
      companyId,
      gatewayId: b.gatewayId,
      dashboardUrl: "https://dashboard.example.com/tienda",
      checkoutUrl: "https://pagar.example.com/tienda",
      bankAccountId: b.bankAccountId,
      payoutDaysOverride: 3,
      defaultExtraIds: [b.extraId],
    });

    expect((await getCompany(user.client, companyId))?.gateways).toEqual([
      {
        id,
        gatewayId: b.gatewayId,
        dashboardUrl: "https://dashboard.example.com/tienda",
        checkoutUrl: "https://pagar.example.com/tienda",
        bankAccountId: b.bankAccountId,
        payoutDaysOverride: 3,
        defaultExtraIds: [b.extraId],
        active: true,
      },
    ]);

    await saveCompanyGateway(user.client, {
      id,
      companyId,
      gatewayId: b.gatewayId,
      dashboardUrl: null,
      checkoutUrl: null,
      bankAccountId: null,
      payoutDaysOverride: null,
      defaultExtraIds: null,
    });
    expect((await getCompany(user.client, companyId))?.gateways).toEqual([
      {
        id,
        gatewayId: b.gatewayId,
        dashboardUrl: null,
        checkoutUrl: null,
        bankAccountId: null,
        payoutDaysOverride: null,
        defaultExtraIds: null,
        active: true,
      },
    ]);
  });

  it("la misma pasarela dos veces en una empresa da su mensaje", async () => {
    await expectUserError(
      () =>
        saveCompanyGateway(user.client, {
          companyId: b.companyId,
          gatewayId: b.gatewayId,
          dashboardUrl: null,
          checkoutUrl: null,
          bankAccountId: null,
          payoutDaysOverride: null,
          defaultExtraIds: null,
        }),
      REPEATED_GATEWAY,
    );
  });

  it("una opción que no es de esa pasarela no se guarda", async () => {
    const companyId = await newCompany();
    await expectUserError(
      () =>
        saveCompanyGateway(user.client, {
          companyId,
          gatewayId: b.gatewayId,
          dashboardUrl: null,
          checkoutUrl: null,
          bankAccountId: null,
          payoutDaysOverride: null,
          defaultExtraIds: [randomUUID()],
        }),
      "Alguna de las opciones elegidas no es de esa pasarela.",
    );
    expect((await getCompany(user.client, companyId))?.gateways).toEqual([]);
  });

  it("se quita de la empresa; quitar una que ya no está lo dice", async () => {
    const companyId = await newCompany();
    const id = await saveCompanyGateway(user.client, {
      companyId,
      gatewayId: b.gatewayId,
      dashboardUrl: null,
      checkoutUrl: null,
      bankAccountId: null,
      payoutDaysOverride: null,
      defaultExtraIds: null,
    });

    await expectUserError(() => deleteCompanyGateway(other.client, id), "Esa pasarela ya no está en esta empresa.");
    await deleteCompanyGateway(user.client, id);
    expect((await getCompany(user.client, companyId))?.gateways).toEqual([]);
    await expectUserError(() => deleteCompanyGateway(user.client, id), "Esa pasarela ya no está en esta empresa.");
  });
});

describe("setCompanyLogo", () => {
  it("guarda una imagen de la carpeta de la empresa", async () => {
    const companyId = await newCompany();
    const path = await uploadLogo(companyId);

    await setCompanyLogo(user.client, user.id, { companyId, path });

    expect(await companyRow(companyId)).toMatchObject({ logo_path: path });
  });

  it("al cambiarlo borra el archivo anterior, y al quitarlo borra el que tenía", async () => {
    const companyId = await newCompany();
    const first = await uploadLogo(companyId);
    await setCompanyLogo(user.client, user.id, { companyId, path: first });
    const second = await uploadLogo(companyId);

    await setCompanyLogo(user.client, user.id, { companyId, path: second });
    expect(await companyRow(companyId)).toMatchObject({ logo_path: second });
    expect(await filesIn(`${user.id}/${companyId}`)).toEqual([second]);

    await setCompanyLogo(user.client, user.id, { companyId, path: null });
    expect(await companyRow(companyId)).toMatchObject({ logo_path: null });
    expect(await filesIn(`${user.id}/${companyId}`)).toEqual([]);
  });

  it("rechaza una ruta que no es de la carpeta de esa empresa del usuario", async () => {
    const companyId = await newCompany();
    const elsewhere = await uploadLogo(b.companyId);
    const message = "El logo no corresponde a esa empresa.";

    for (const path of [
      elsewhere,
      `${other.id}/${companyId}/${randomUUID()}.png`,
      `${user.id}/${companyId}/`,
      `${user.id}/${companyId}/sub/${randomUUID()}.png`,
    ]) {
      await expectUserError(() => setCompanyLogo(user.client, user.id, { companyId, path }), message);
    }
    expect(await companyRow(companyId)).toMatchObject({ logo_path: null });
  });

  it("rechaza un archivo que no llegó a subirse", async () => {
    const companyId = await newCompany();
    await expectUserError(
      () => setCompanyLogo(user.client, user.id, { companyId, path: `${user.id}/${companyId}/${randomUUID()}.png` }),
      "El archivo no llegó a subirse. Vuelve a intentarlo.",
    );
  });

  it("rechaza lo que no es una imagen y no lo deja en Storage", async () => {
    const companyId = await newCompany();
    const pdf = await uploadLogo(companyId, Buffer.from("%PDF-1.7\n%demo\n"), "application/pdf");

    await expectUserError(
      () => setCompanyLogo(user.client, user.id, { companyId, path: pdf }),
      "El logo tiene que ser una imagen JPG, PNG o WebP.",
    );
    expect(await filesIn(`${user.id}/${companyId}`)).toEqual([]);
    expect(await companyRow(companyId)).toMatchObject({ logo_path: null });
  });

  it("la empresa de otro usuario no existe", async () => {
    await expectUserError(
      () => setCompanyLogo(other.client, other.id, { companyId: b.companyId, path: null }),
      "Esa empresa ya no existe.",
    );
  });
});

describe("deleteCompany", () => {
  it("sin cobros: borra sus archivos de logo y después la empresa, con sus canales y sus pasarelas", async () => {
    const companyId = await newCompany();
    await saveChannel(user.client, {
      companyId,
      name: "Tienda en línea",
      url: null,
      platformFeePct: "3",
      platformFeeFixed: "0.25",
      active: true,
    });
    await saveCompanyGateway(user.client, {
      companyId,
      gatewayId: b.gatewayId,
      dashboardUrl: null,
      checkoutUrl: null,
      bankAccountId: null,
      payoutDaysOverride: null,
      defaultExtraIds: null,
    });
    const logo = await uploadLogo(companyId);
    await setCompanyLogo(user.client, user.id, { companyId, path: logo });
    // Un archivo suelto en la carpeta (una subida que no se llegó a guardar) también se va.
    await uploadLogo(companyId);

    await deleteCompany(user.client, user.id, companyId);

    expect(await companyRow(companyId)).toBeNull();
    expect(await filesIn(`${user.id}/${companyId}`)).toEqual([]);
    const leftovers = await Promise.all([
      admin.from("pay_channels").select("id").eq("company_id", companyId),
      admin.from("pay_company_gateways").select("id").eq("company_id", companyId),
    ]);
    expect(leftovers.map((res) => res.data)).toEqual([[], []]);
  });

  it("con cobros (aunque estén en la papelera) no se borra, y su logo sigue ahí", async () => {
    const companyId = await newCompany();
    const logo = await uploadLogo(companyId);
    await setCompanyLogo(user.client, user.id, { companyId, path: logo });
    const [saved] = await saveTransactions(user.client, [e1Item(b, { company_id: companyId, channel_id: null })]);
    // A la papelera: un cobro borrado sigue siendo un cobro de la empresa.
    unwrap(
      await admin
        .from("pay_transactions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", saved?.id ?? "")
        .select("id")
        .single(),
      "cobro a la papelera",
    );

    await expectUserError(() => deleteCompany(user.client, user.id, companyId), IN_USE);

    expect(await companyRow(companyId)).toMatchObject({ logo_path: logo });
    expect(await filesIn(`${user.id}/${companyId}`)).toEqual([logo]);
  });

  it("la de otro usuario no existe y no se toca", async () => {
    await expectUserError(() => deleteCompany(other.client, other.id, b.companyId), "Esa empresa ya no existe.");
    expect(await companyRow(b.companyId)).not.toBeNull();
  });
});

describe("las lecturas", () => {
  it("getCompany trae la ficha completa y lo facturado en total por moneda, sin papelera ni fallidos", async () => {
    const owner = await createUser();
    const ob = await seedBasics(owner.client);
    await owner.client
      .from("pay_companies")
      .update({ website: "https://escuela.example.com", notes: "Demo" })
      .eq("id", ob.companyId)
      .throwOnError();
    await saveTransactions(owner.client, [
      e1Item(ob),
      e1Item(ob, { occurred_at: "2026-10-02T15:00:00+00:00", occurred_on: "2026-10-02" }),
    ]);

    const company = await getCompany(owner.client, ob.companyId);

    expect(company).toEqual({
      id: ob.companyId,
      name: "Escuela Demo",
      website: "https://escuela.example.com",
      logoPath: null,
      currency: "USD",
      defaultSchemeId: ob.schemeId,
      notes: "Demo",
      active: true,
      channels: [
        {
          id: ob.channelId,
          name: "Inscripciones en línea",
          url: null,
          platformFeePct: "5",
          platformFeeFixed: "0.00",
          active: true,
        },
      ],
      gateways: [
        {
          id: ob.companyGatewayId,
          gatewayId: ob.gatewayId,
          dashboardUrl: null,
          checkoutUrl: null,
          bankAccountId: ob.bankAccountId,
          payoutDaysOverride: null,
          defaultExtraIds: null,
          active: true,
        },
      ],
      totals: [
        {
          currency: "USD",
          count: 2,
          gross: "200.00",
          fees: "19.40",
          net: "180.60",
          firstOn: "2026-10-02",
          lastOn: "2026-11-13",
        },
      ],
    });
  });

  it("getCompany da null si no existe, si es de otro usuario o si el id no es un uuid", async () => {
    expect(await getCompany(user.client, randomUUID())).toBeNull();
    expect(await getCompany(other.client, b.companyId)).toBeNull();
    expect(await getCompany(user.client, "no-es-un-id")).toBeNull();
  });

  it("listCompanies trae las del usuario por nombre, con su total por moneda", async () => {
    const owner = await createUser();
    const ob = await seedBasics(owner.client);
    const second = await saveCompany(owner.client, {
      name: "Academia Demo",
      website: null,
      currency: "USD",
      defaultSchemeId: null,
      notes: null,
    });
    await saveTransactions(owner.client, [e1Item(ob)]);

    expect(await listCompanies(owner.client)).toEqual([
      {
        id: second,
        name: "Academia Demo",
        website: null,
        logoPath: null,
        currency: "USD",
        active: true,
        totals: [],
      },
      {
        id: ob.companyId,
        name: "Escuela Demo",
        website: null,
        logoPath: null,
        currency: "USD",
        active: true,
        totals: [
          {
            currency: "USD",
            count: 1,
            gross: "100.00",
            fees: "9.70",
            net: "90.30",
            firstOn: "2026-11-13",
            lastOn: "2026-11-13",
          },
        ],
      },
    ]);
  });

  it("companyLogoUrls firma los logos por 60 segundos; uno que ya no está no trae URL", async () => {
    const companyId = await newCompany();
    const path = await uploadLogo(companyId);
    const missing = `${user.id}/${companyId}/${randomUUID()}.png`;

    const urls = await companyLogoUrls(user.client, [path, missing]);

    const token = new URL(urls.get(path) ?? "").searchParams.get("token") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      iat: number;
      exp: number;
    };
    expect(claims.exp - claims.iat).toBe(60);
    expect(urls.has(missing)).toBe(false);
  });
});
