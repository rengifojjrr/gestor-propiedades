import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createUser, enrollTotp, signInAal1, type Db, type TestUser } from "./helpers";

/**
 * Comprobantes: bucket privado «comprobantes». Cada usuario solo entra a su carpeta `{user_id}/…`, con la misma
 * regla de segundo factor que las tablas. El bucket limita el tamaño (10 MB) y el tipo (jpg, png, webp, pdf).
 */

const BUCKET = "comprobantes";
/** Los primeros bytes de un PNG: al bucket le basta el tipo declarado; aquí importa que vuelvan los mismos. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const subir = (client: Db, path: string, body: Buffer = PNG, contentType = "image/png") =>
  client.storage.from(BUCKET).upload(path, body, { contentType });

/** Lo que el Storage rechaza trae el código HTTP como texto en `statusCode`. */
const codigo = (error: unknown): string | undefined => (error as { statusCode?: string } | null)?.statusCode;

/** Comprueba que `client` no puede listar, firmar, descargar ni borrar ese archivo, y que el archivo sigue ahí. */
async function expectSinAcceso(client: Db, path: string): Promise<void> {
  const carpeta = path.slice(0, path.lastIndexOf("/"));
  const bucket = client.storage.from(BUCKET);

  const lista = await bucket.list(carpeta);
  expect(lista.data ?? []).toEqual([]);

  const firma = await bucket.createSignedUrl(path, 60);
  expect(firma.error).not.toBeNull();
  expect(firma.data).toBeNull();

  const descarga = await bucket.download(path);
  expect(descarga.error).not.toBeNull();
  expect(descarga.data).toBeNull();

  // remove() sobre rutas sin permiso no da error: dice cuántos borró.
  const borrado = await bucket.remove([path]);
  expect(borrado.data ?? []).toEqual([]);

  const sigue = await adminClient().storage.from(BUCKET).download(path);
  expect(sigue.error).toBeNull();
}

let a: TestUser;
let b: TestUser;
/** Un comprobante de A, subido antes de que A activara su segundo factor. */
let reciboDeA: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createUser(), createUser()]);
  reciboDeA = `${a.id}/${randomUUID()}/recibo.png`;
  const subida = await subir(a.client, reciboDeA);
  if (subida.error) throw new Error(`A no pudo subir su comprobante: ${subida.error.message}`);
});

describe("el bucket «comprobantes»", () => {
  it("es privado, de 10 MB como máximo y solo admite jpg, png, webp y pdf", async () => {
    const { data, error } = await adminClient().storage.getBucket(BUCKET);

    expect(error).toBeNull();
    expect(data?.public).toBe(false);
    expect(data?.file_size_limit).toBe(10 * 1024 * 1024);
    expect([...(data?.allowed_mime_types ?? [])].sort()).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("rechaza un archivo de 11 MB", async () => {
    const path = `${b.id}/${randomUUID()}/enorme.png`;

    const { data, error } = await subir(b.client, path, Buffer.alloc(11 * 1024 * 1024));

    expect(data).toBeNull();
    expect(codigo(error)).toBe("413");
    expect((await b.client.storage.from(BUCKET).download(path)).data).toBeNull();
  });

  it("rechaza un text/plain", async () => {
    const path = `${b.id}/${randomUUID()}/nota.txt`;

    const { data, error } = await subir(b.client, path, Buffer.from("hola"), "text/plain");

    expect(data).toBeNull();
    expect(codigo(error)).toBe("415");
    expect((await b.client.storage.from(BUCKET).download(path)).data).toBeNull();
  });
});

describe("cada usuario solo entra a su carpeta", () => {
  it("A lee, lista y firma lo que subió en su carpeta", async () => {
    const bucket = a.client.storage.from(BUCKET);
    const carpeta = reciboDeA.slice(0, reciboDeA.lastIndexOf("/"));

    const descarga = await bucket.download(reciboDeA);
    expect(descarga.error).toBeNull();
    expect(Buffer.from(await (descarga.data as Blob).arrayBuffer()).equals(PNG)).toBe(true);

    const lista = await bucket.list(carpeta);
    expect(lista.data?.map((archivo) => archivo.name)).toEqual(["recibo.png"]);

    const firma = await bucket.createSignedUrl(reciboDeA, 60);
    expect(firma.error).toBeNull();
    const porUrl = await fetch(firma.data?.signedUrl ?? "");
    expect(porUrl.status).toBe(200);
    expect(Buffer.from(await porUrl.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("A no puede subir en la carpeta de B", async () => {
    const path = `${b.id}/${randomUUID()}/colado.png`;

    const { data, error } = await subir(a.client, path);

    expect(data).toBeNull();
    expect(codigo(error)).toBe("403");
    expect((await adminClient().storage.from(BUCKET).download(path)).data).toBeNull();
  });

  it("B no lista, firma, descarga ni borra los archivos de A", async () => {
    await expectSinAcceso(b.client, reciboDeA);
  });

  it("B no puede reemplazar un archivo de A", async () => {
    const res = await b.client.storage.from(BUCKET).upload(reciboDeA, Buffer.from("otro"), {
      contentType: "image/png",
      upsert: true,
    });

    expect(res.data).toBeNull();
    expect(res.error).not.toBeNull();
    const intacto = await adminClient().storage.from(BUCKET).download(reciboDeA);
    expect(Buffer.from(await (intacto.data as Blob).arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("anon no sube ni ve nada", async () => {
    const anon = anonClient();

    const subida = await subir(anon, `${a.id}/${randomUUID()}/anonimo.png`);
    expect(subida.data).toBeNull();
    expect(subida.error).not.toBeNull();

    await expectSinAcceso(anon, reciboDeA);
  });
});

describe("con segundo factor verificado", () => {
  let aAal1: Db;

  beforeAll(async () => {
    await enrollTotp(a.client);
    aAal1 = await signInAal1(a.email, a.password);
  });

  it("en una sesión aal1 no sube ni ve nada, ni en su propia carpeta", async () => {
    const path = `${a.id}/${randomUUID()}/sin-segundo-factor.png`;

    const subida = await subir(aAal1, path);
    expect(subida.data).toBeNull();
    expect(codigo(subida.error)).toBe("403");
    expect((await adminClient().storage.from(BUCKET).download(path)).data).toBeNull();

    await expectSinAcceso(aAal1, reciboDeA);
  });

  it("en la sesión aal2 sube y lee en su carpeta", async () => {
    const path = `${a.id}/${randomUUID()}/con-segundo-factor.png`;

    const subida = await subir(a.client, path);
    expect(subida.error).toBeNull();

    const descarga = await a.client.storage.from(BUCKET).download(path);
    expect(descarga.error).toBeNull();
    expect(Buffer.from(await (descarga.data as Blob).arrayBuffer()).equals(PNG)).toBe(true);

    const anterior = await a.client.storage.from(BUCKET).download(reciboDeA);
    expect(anterior.error).toBeNull();
  });
});

/** Los claims del token de la sesión de `client`, tal como los firmó Auth (con su `aal` y su `session_id`). */
async function claimsDe(client: Db): Promise<Record<string, unknown>> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("El cliente no tiene sesión");
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
}

/**
 * Corre UNA sentencia como `postgres` en la base del stack local, con la CLI de Supabase del proyecto (la que lo
 * levanta: sin `--remote` nunca sale de la máquina). Va al stack de `supabase/config.toml`; otro stack local se
 * elige con `SUPABASE_WORKDIR`. La sentencia tiene que terminar en error, y se devuelve su mensaje: así se deshace
 * entera y nada de lo que crea llega a existir para nadie más.
 */
async function mensajeDeError(sql: string): Promise<string> {
  try {
    await promisify(execFile)("npx", ["--no-install", "supabase", "db", "query", "--output-format", "json", sql]);
  } catch (error) {
    const salida = (error as { stdout?: string }).stdout ?? "";
    const respuesta = JSON.parse(salida) as { error?: { message?: string } };
    if (respuesta.error?.message) return respuesta.error.message;
  }
  throw new Error("La sentencia debía terminar en error");
}

describe("aunque el proyecto tenga otra política de storage.objects que deje ver todo", () => {
  it("con factor, una sesión aal1 no ve nada de «comprobantes» y una aal2 solo lo suyo", async () => {
    const [c, d] = await Promise.all([createUser(), createUser()]);
    await enrollTotp(c.client);
    const cAal1 = await signInAal1(c.email, c.password);
    for (const [client, id] of [
      [c.client, c.id],
      [d.client, d.id],
    ] as const) {
      const subida = await subir(client, `${id}/${randomUUID()}/recibo.png`);
      if (subida.error) throw new Error(`No se pudo subir el comprobante: ${subida.error.message}`);
    }
    const sesiones = [await claimsDe(cAal1), await claimsDe(c.client)];
    expect(sesiones.map((claims) => claims.aal)).toEqual(["aal1", "aal2"]);

    // Todo en una transacción que termina en error a propósito: la política amplia (permisiva, sin bucket, como
    // las de los ejemplos de la documentación) se crea, se prueba con cada sesión y se deshace.
    const lista = sesiones.map((claims) => `'${JSON.stringify(claims).replaceAll("'", "''")}'::jsonb`).join(", ");
    const mensaje = await mensajeDeError(`
      do $prueba$
      declare
        sesion jsonb;
        visto jsonb := '{}';
      begin
        create policy pay_prueba_ver_todo on storage.objects for select to authenticated using (true);
        perform set_config('role', 'authenticated', true);
        foreach sesion in array array[${lista}] loop
          perform set_config('request.jwt.claims', sesion::text, true);
          visto := visto || jsonb_build_object(sesion ->> 'aal', jsonb_build_object(
            'propios', (select count(*) from storage.objects o
                        where o.bucket_id = '${BUCKET}' and o.name like (sesion ->> 'sub') || '/%'),
            'ajenos', (select count(*) from storage.objects o
                       where o.bucket_id = '${BUCKET}' and o.name not like (sesion ->> 'sub') || '/%')
          ));
        end loop;
        raise exception 'visto: %', visto;
      end
      $prueba$`);

    const visto = mensaje.match(/visto: (\{.*\})/)?.[1];
    expect(visto, mensaje).toBeDefined();
    expect(JSON.parse(visto ?? "")).toEqual({
      aal1: { propios: 0, ajenos: 0 },
      aal2: { propios: 1, ajenos: 0 },
    });
  });
});
