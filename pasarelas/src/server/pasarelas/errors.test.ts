import { PostgrestError, StorageApiError } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { PAY_RULE_TEXT, PAY_STATE_TEXT, PayRuleError, PayStateError } from "@/lib/pasarelas";
import type { PayRuleCode, PayStateCode } from "@/lib/pasarelas";
import { UserError, errorMessage, isExpectedError } from "./errors";

const GENERIC = "No se pudo guardar. Inténtalo de nuevo.";
const SECOND_FACTOR = "Verifica tu segundo factor para seguir";

/** Un error de PostgREST con la forma real: un objeto llano `{ code, details, hint, message }`. */
const db = (code: string, message: string, details: string | null = null) => ({ code, details, hint: null, message });

/** Un error de Storage con la forma real: un `Error` con el código HTTP como TEXTO en `statusCode`. */
function storage(statusCode: string, code: string, message: string): Error {
  return Object.assign(new Error(message), {
    __isStorageError: true,
    namespace: "storage",
    name: "StorageApiError",
    status: 400,
    statusCode,
    code,
  });
}

const unique = (constraint: string) => db("23505", `duplicate key value violates unique constraint "${constraint}"`);
const check = (constraint: string) =>
  db("23514", `new row for relation "pay_transactions" violates check constraint "${constraint}"`);

describe("errores esperados: su mensaje se enseña tal cual", () => {
  test("UserError", () => {
    const error = new UserError("Elige al menos un cobro.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UserError");
    expect(errorMessage(error)).toBe("Elige al menos un cobro.");
  });

  test("PayStateError: el texto del motor para cada código", () => {
    for (const code of Object.keys(PAY_STATE_TEXT) as PayStateCode[]) {
      expect(errorMessage(new PayStateError(code))).toBe(PAY_STATE_TEXT[code]);
    }
  });

  test("PayRuleError: el texto del motor para cada código", () => {
    for (const code of Object.keys(PAY_RULE_TEXT) as PayRuleCode[]) {
      expect(errorMessage(new PayRuleError(code))).toBe(PAY_RULE_TEXT[code]);
    }
  });

});

describe("un ZodError lanzado es un fallo interno", () => {
  // La entrada de la persona no llega aquí: `runAction` la valida con `safeParse` y devuelve los errores por
  // campo. Un ZodError lanzado viene de algo guardado que no se deja leer o de una respuesta con otra forma.
  test("da el mensaje general, sin enseñar el texto de Zod", () => {
    const schema = z.object({ monto: z.string().regex(/^\d+$/, { error: "Monto no válido" }) });
    const result = schema.safeParse({ monto: "abc" });
    expect(result.success).toBe(false);
    expect(errorMessage(result.error)).toBe(GENERIC);
    expect(errorMessage(new z.ZodError([]))).toBe(GENERIC);
  });
});

describe("errores de la base (PostgREST)", () => {
  test("23505: cada nombre repetido dice qué se repite", () => {
    expect(errorMessage(unique("pay_companies_name_uq"))).toBe("Ya hay una empresa con ese nombre.");
    expect(errorMessage(unique("pay_gateways_name_uq"))).toBe("Ya hay una pasarela con ese nombre.");
    expect(errorMessage(unique("pay_beneficiaries_name_uq"))).toBe("Ya hay un beneficiario con ese nombre.");
    expect(errorMessage(unique("pay_schemes_name_uq"))).toBe("Ya hay un esquema de reparto con ese nombre.");
    expect(errorMessage(unique("pay_transactions_reference_uq"))).toBe(
      "Ya hay un cobro de esa pasarela con esa referencia.",
    );
  });

  test("23505 de otra restricción: se dice que está repetido, sin nombrar la restricción", () => {
    expect(errorMessage(unique("pay_holidays_user_id_day_key"))).toBe("Ya existe un registro con esos datos.");
  });

  test("23503: borrar algo que todavía se usa", () => {
    const error = db(
      "23503",
      'update or delete on table "pay_beneficiaries" violates foreign key constraint "pay_scheme_lines_beneficiary_id_user_id_fkey" on table "pay_scheme_lines"',
      'Key is still referenced from table "pay_scheme_lines".',
    );
    expect(errorMessage(error)).toBe("No se puede borrar: todavía se usa en cobros o en otros registros.");
  });

  test("23503: apuntar a algo que ya no existe", () => {
    const error = db(
      "23503",
      'insert or update on table "pay_channels" violates foreign key constraint "pay_channels_company_id_user_id_fkey"',
      'Key is not present in table "pay_companies".',
    );
    expect(errorMessage(error)).toBe("Algo de lo elegido ya no existe. Vuelve a cargar la página.");
  });

  test("23503 de pay_save_scheme: la versión del esquema ya tiene cobros", () => {
    const error = db("23503", "pay_scheme_version_in_use: ya hay cobros con la versión vigente desde 2000-01-01");
    expect(errorMessage(error)).toBe(
      "Ya hay cobros con la versión del esquema vigente desde esa fecha: elige otra fecha.",
    );
  });

  test("23514: los cuadres que defiende la base", () => {
    expect(errorMessage(db("23514", "pay_alloc_sum_mismatch: el reparto (90.31) no suma su base (90.30)"))).toBe(
      "El reparto no suma exactamente su base. No se guardó nada.",
    );
    expect(errorMessage(db("23514", "pay_scheme_over_100: las líneas suman 120.0000 %"))).toBe(
      "Las líneas del esquema suman más de 100 %.",
    );
    expect(errorMessage(db("23514", "pay_scheme_under_100: las líneas suman 50.0000 % y no hay «Resto»"))).toBe(
      "Las líneas del esquema suman menos de 100 %: elige quién recibe el resto.",
    );
    expect(errorMessage(db("23514", "pay_scheme_remainder_in_lines: el «Resto» no puede ser además una línea"))).toBe(
      "Quien recibe el resto no puede ser además una línea del esquema.",
    );
    expect(errorMessage(check("pay_transactions_alloc_base_check"))).toBe(
      "La base del reparto no coincide con el cobro. No se guardó nada.",
    );
  });

  test("23514 de otra restricción: algo no cumple las reglas, sin decir cuál restricción", () => {
    expect(errorMessage(check("pay_transactions_net_check"))).toBe(
      "Algún dato no cumple las reglas del libro. Revísalo e inténtalo de nuevo.",
    );
    // No se confunde con la que sí tiene mensaje propio, aunque el nombre empiece igual.
    expect(errorMessage(check("pay_transactions_alloc_base_kind_check"))).toBe(
      "Algún dato no cumple las reglas del libro. Revísalo e inténtalo de nuevo.",
    );
  });

  test("40001: el cobro cambió mientras se editaba", () => {
    const error = db(
      "40001",
      "pay_tx_conflict: el cobro c0106f1e-abe8-4532-b40a-bda053aa7785 cambió mientras lo editabas",
    );
    expect(errorMessage(error)).toBe("Este cobro cambió mientras lo editabas: vuelve a abrirlo");
  });

  test("P0002: ya no existe", () => {
    expect(errorMessage(db("P0002", "pay_tx_not_found: no existe el cobro d8c38940-d00d-47af-bee4-17cd337b12dc"))).toBe(
      "Ese cobro ya no existe.",
    );
    expect(errorMessage(db("P0002", "pay_scheme_not_found: no existe el esquema d8c38940"))).toBe(
      "Ese esquema de reparto ya no existe.",
    );
    expect(errorMessage(db("P0002", "otra cosa"))).toBe("Ese registro ya no existe.");
  });

  test("42501: la sesión no pasó el segundo factor", () => {
    const error = db(
      "42501",
      'new row violates row-level security policy "pay_companies_mfa" for table "pay_companies"',
    );
    expect(errorMessage(error)).toBe(SECOND_FACTOR);
  });

  test("28000 de las funciones pay_: no hay sesión", () => {
    expect(errorMessage(db("28000", "pay_no_session: hace falta una sesión"))).toBe(
      "Tu sesión terminó. Vuelve a entrar.",
    );
  });

  test("cualquier otro código: el mensaje general", () => {
    expect(errorMessage(db("22023", "pay_bad_payload: entre 1 y 500 cobros por llamada (llegaron 0)"))).toBe(GENERIC);
    expect(errorMessage(db("22P02", 'invalid input syntax for type uuid: "no-uuid"'))).toBe(GENERIC);
    expect(errorMessage(db("22003", "numeric field overflow"))).toBe(GENERIC);
    expect(errorMessage(db("PGRST103", "Requested range not satisfiable"))).toBe(GENERIC);
    // El mismo código sin el prefijo que lo identifica no se da por conocido.
    expect(errorMessage(db("40001", "could not serialize access due to concurrent update"))).toBe(GENERIC);
    expect(errorMessage(db("28000", "role does not exist"))).toBe(GENERIC);
  });
});

describe("errores de Storage (el código HTTP viene como texto en statusCode)", () => {
  test("cada rechazo conocido tiene su mensaje", () => {
    expect(errorMessage(storage("413", "EntityTooLarge", "The object exceeded the maximum allowed size"))).toBe(
      "El archivo pesa más de 10 MB.",
    );
    expect(errorMessage(storage("415", "InvalidMimeType", "mime type text/plain is not supported"))).toBe(
      "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.",
    );
    expect(errorMessage(storage("409", "KeyAlreadyExists", "The resource already exists"))).toBe(
      "Ya hay un archivo con ese nombre.",
    );
    expect(errorMessage(storage("404", "NoSuchKey", "Object not found"))).toBe("Ese archivo ya no existe.");
    expect(errorMessage(storage("403", "AccessDenied", "new row violates row-level security policy"))).toBe(
      SECOND_FACTOR,
    );
  });

  test("otro rechazo de Storage: el mensaje general (su `code` no se toma por un código de la base)", () => {
    expect(errorMessage(storage("500", "InternalError", "Internal Server Error"))).toBe(GENERIC);
    expect(errorMessage(storage("400", "23505", "duplicate"))).toBe(GENERIC);
  });
});

describe("los mismos errores cuando llegan lanzados, con las clases de supabase-js", () => {
  test("PostgrestError (lo que lanza throwOnError): un Error con su code", () => {
    const thrown = new PostgrestError({
      code: "40001",
      message: "pay_tx_conflict: el cobro c0106f1e-abe8-4532-b40a-bda053aa7785 cambió mientras lo editabas",
      details: "",
      hint: "",
    });
    expect(thrown).toBeInstanceOf(Error);
    expect(errorMessage(thrown)).toBe("Este cobro cambió mientras lo editabas: vuelve a abrirlo");
    expect(
      errorMessage(
        new PostgrestError({
          code: "23505",
          message: 'duplicate key value violates unique constraint "pay_gateways_name_uq"',
          details: "",
          hint: "",
        }),
      ),
    ).toBe("Ya hay una pasarela con ese nombre.");
  });

  test("StorageApiError", () => {
    const thrown = new StorageApiError(
      "The object exceeded the maximum allowed size",
      400,
      "413",
      "storage",
      "EntityTooLarge",
    );
    expect(errorMessage(thrown)).toBe("El archivo pesa más de 10 MB.");
  });
});

describe("lo desconocido", () => {
  test("cualquier otra cosa: el mensaje general", () => {
    for (const thing of [
      new Error("fetch failed"),
      new RangeError("No es un decimal finito: «x»"),
      "texto",
      7,
      null,
      undefined,
      {},
      { code: 23505 },
    ]) {
      expect(errorMessage(thing)).toBe(GENERIC);
    }
  });

  test("nunca sale texto interno de la base: ni restricciones, ni tablas, ni ids, ni el mensaje original", () => {
    const internals = [
      unique("pay_companies_name_uq"),
      unique("pay_transactions_pkey"),
      check("pay_transactions_alloc_base_check"),
      check("pay_transactions_gross_check"),
      db(
        "23503",
        'update or delete on table "pay_gateways" violates foreign key constraint "x_fkey" on table "pay_transactions"',
      ),
      db("23514", "pay_alloc_sum_mismatch: el reparto (90.31) no suma su base (90.30)"),
      db("40001", "pay_tx_conflict: el cobro c0106f1e-abe8-4532-b40a-bda053aa7785 cambió mientras lo editabas"),
      db("P0002", "pay_tx_not_found: no existe el cobro d8c38940-d00d-47af-bee4-17cd337b12dc"),
      db("42501", 'new row violates row-level security policy "pay_transactions_mfa" for table "pay_transactions"'),
      db("XX000", "internal error at pay_save_transactions line 42"),
      storage("403", "AccessDenied", "new row violates row-level security policy"),
      new Error('relation "pay_transactions" does not exist'),
    ];
    for (const error of internals) {
      const text = errorMessage(error);
      expect(text).not.toMatch(/pay_|constraint|relation|policy|violates|[0-9a-f]{8}-[0-9a-f]{4}|90\.3/i);
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

describe("isExpectedError: qué hay que registrar en el servidor", () => {
  test("los errores de la app y los rechazos que tienen su mensaje son esperados", () => {
    const expected = [
      new UserError("Ese cobro ya no existe."),
      new PayStateError("reembolso_excede"),
      new PayRuleError("sin_tarifa"),
      unique("pay_companies_name_uq"),
      db("23503", 'insert or update on table "pay_transaction_receipts" violates foreign key constraint "x_fkey"'),
      db("42501", 'new row violates row-level security policy "pay_transactions_mfa"'),
      storage("413", "Payload too large", "The object exceeded the maximum allowed size"),
    ];
    for (const error of expected) expect(isExpectedError(error)).toBe(true);
  });

  test("lo que da el mensaje general no es esperado: un fallo de red, un ZodError lanzado, un SQLSTATE desconocido", () => {
    const zodThrown = z.object({ a: z.string() }).safeParse({}).error;
    const unexpected = [
      new TypeError("fetch failed"),
      zodThrown,
      db("XX000", "internal error at pay_save_transactions line 42"),
      db("40001", "could not serialize access due to concurrent update"),
      storage("500", "InternalError", "Internal Server Error"),
      "algo raro",
      null,
    ];
    for (const error of unexpected) expect(isExpectedError(error)).toBe(false);
  });
});
