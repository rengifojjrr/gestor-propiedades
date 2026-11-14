import { beforeAll, describe, expect, it } from "vitest";
import { usBankHolidays } from "@/lib/pasarelas";
import { deleteBankAccount, saveBankAccount, setBankAccountActive } from "@/server/pasarelas/ops/accounts";
import { addHoliday, deleteHoliday, loadUsHolidays } from "@/server/pasarelas/ops/holidays";
import { listBankAccounts } from "@/server/pasarelas/queries/accounts";
import { listHolidays, yearsWithoutHolidays } from "@/server/pasarelas/queries/holidays";
import { adminClient, createUser, e1Item, saveTransactions, seedBasics, unwrap, type Basics, type TestUser } from "./helpers";

/**
 * Las cuentas destino y los feriados, con la sesión real de usuarios de prueba: lo que dejan en la base las `ops` y
 * lo que leen las consultas de sus pantallas. Cada usuario solo toca lo suyo.
 */

const admin = adminClient();

const NEW_ACCOUNT = {
  id: null,
  alias: "Cuenta de ahorros",
  institution: "Banco Demo",
  last4: "9876",
  currency: "USD",
  notes: null,
};

describe("cuentas destino", () => {
  let user: TestUser;
  let other: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, other] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  it("saveBankAccount crea una cuenta y, con su id, la edita", async () => {
    const id = await saveBankAccount(user.client, NEW_ACCOUNT);
    const row = () =>
      admin.from("pay_bank_accounts").select("user_id, alias, institution, last4, currency, notes, active").eq("id", id);

    expect(unwrap(await row().single(), "cuenta")).toEqual({
      user_id: user.id,
      alias: "Cuenta de ahorros",
      institution: "Banco Demo",
      last4: "9876",
      currency: "USD",
      notes: null,
      active: true,
    });

    const same = await saveBankAccount(user.client, {
      id,
      alias: "Cuenta en euros",
      institution: null,
      last4: null,
      currency: "EUR",
      notes: "Solo para Escuela Demo",
    });
    expect(same).toBe(id);
    expect(unwrap(await row().single(), "cuenta editada")).toEqual({
      user_id: user.id,
      alias: "Cuenta en euros",
      institution: null,
      last4: null,
      currency: "EUR",
      notes: "Solo para Escuela Demo",
      active: true,
    });
  });

  it("editar la cuenta de otro usuario (o una que no existe) no toca nada y lo dice", async () => {
    await expect(saveBankAccount(other.client, { ...NEW_ACCOUNT, id: basics.bankAccountId })).rejects.toThrow(
      "Esa cuenta ya no existe.",
    );
    await expect(setBankAccountActive(other.client, basics.bankAccountId, false)).rejects.toThrow(
      "Esa cuenta ya no existe.",
    );
    await expect(deleteBankAccount(other.client, basics.bankAccountId)).rejects.toThrow("Esa cuenta ya no existe.");
    const row = unwrap(
      await admin.from("pay_bank_accounts").select("alias, active").eq("id", basics.bankAccountId).single(),
      "cuenta",
    );
    expect(row).toEqual({ alias: "Cuenta principal", active: true });
  });

  it("setBankAccountActive la desactiva y la vuelve a activar", async () => {
    const id = await saveBankAccount(user.client, { ...NEW_ACCOUNT, alias: "Cuenta vieja" });
    const active = async () =>
      unwrap(await admin.from("pay_bank_accounts").select("active").eq("id", id).single(), "cuenta").active;

    await setBankAccountActive(user.client, id, false);
    expect(await active()).toBe(false);
    await setBankAccountActive(user.client, id, true);
    expect(await active()).toBe(true);
  });

  it("listBankAccounts da por cuenta y moneda lo depositado, lo que está por caer y cuánto tarda", async () => {
    const [deposited, pending, disputed] = await saveTransactions(user.client, [
      e1Item(basics, {
        reference: "pi_cuentas_1",
        status: "depositado",
        deposited_on: "2026-11-16",
      }),
      e1Item(basics, { reference: "pi_cuentas_2" }),
      // Con la disputa abierta no está por caer: la pasarela retiene el dinero.
      e1Item(basics, { reference: "pi_cuentas_3", dispute_state: "abierta", dispute_opened_on: "2026-11-14" }),
    ]);
    expect([deposited?.inserted, pending?.inserted, disputed?.inserted]).toEqual([true, true, true]);

    const accounts = await listBankAccounts(user.client);
    const principal = accounts.find((account) => account.id === basics.bankAccountId);
    expect(principal).toEqual({
      id: basics.bankAccountId,
      alias: "Cuenta principal",
      institution: "Banco Demo",
      last4: "4321",
      currency: "USD",
      notes: null,
      active: true,
      txCount: 3,
      gatewayCount: 1,
      totals: [
        {
          currency: "USD",
          depositedCount: 1,
          depositedNet: "90.30",
          pendingCount: 1,
          pendingNet: "90.30",
          // Sin retención, lo que llega al banco es el neto.
          depositedPayout: "90.30",
          pendingPayout: "90.30",
          avgDays: "3.00",
          medianDays: "3.00",
        },
      ],
    });
    // Una cuenta sin cobros sale igual, sin totales.
    expect(accounts.find((account) => account.alias === "Cuenta vieja")).toMatchObject({
      txCount: 0,
      gatewayCount: 0,
      totals: [],
    });
    // Las activas primero y, dentro, por alias.
    const order = accounts.map((account) => [account.active, account.alias]);
    expect(order).toEqual(
      [...order].sort(([aActive, aAlias], [bActive, bAlias]) =>
        aActive === bActive ? String(aAlias).localeCompare(String(bAlias)) : aActive ? -1 : 1,
      ),
    );
    // Otro usuario no ve ninguna.
    expect(await listBankAccounts(other.client)).toEqual([]);
  });

  it("deleteBankAccount la borra y los cobros y las cuentas de pasarela que la usaban quedan sin cuenta", async () => {
    const id = await saveBankAccount(user.client, { ...NEW_ACCOUNT, alias: "Cuenta a borrar" });
    const [tx] = await saveTransactions(user.client, [
      e1Item({ ...basics, bankAccountId: id }, { reference: "pi_cuentas_borrar" }),
    ]);
    await admin.from("pay_company_gateways").update({ bank_account_id: id }).eq("id", basics.companyGatewayId).throwOnError();

    await deleteBankAccount(user.client, id);

    const gone = await admin.from("pay_bank_accounts").select("id").eq("id", id);
    expect(gone.data).toEqual([]);
    const txRow = unwrap(
      await admin.from("pay_transactions").select("bank_account_id").eq("id", tx?.id ?? "").single(),
      "cobro",
    );
    expect(txRow.bank_account_id).toBeNull();
    const companyGateway = unwrap(
      await admin.from("pay_company_gateways").select("bank_account_id").eq("id", basics.companyGatewayId).single(),
      "cuenta de la pasarela",
    );
    expect(companyGateway.bank_account_id).toBeNull();
  });
});

describe("feriados", () => {
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    [user, other] = await Promise.all([createUser(), createUser()]);
  });

  it("addHoliday agrega un feriado y otro el mismo día se rechaza con su mensaje", async () => {
    const id = await addHoliday(user.client, { day: "2030-03-17", name: "Día de cierre demo" });
    expect(await listHolidays(user.client, 2030)).toEqual([{ id, day: "2030-03-17", name: "Día de cierre demo" }]);

    await expect(addHoliday(user.client, { day: "2030-03-17", name: "Otro" })).rejects.toThrow(
      "Ya hay un feriado ese día.",
    );
    // Otro usuario puede tener el suyo el mismo día.
    await expect(addHoliday(other.client, { day: "2030-03-17", name: "Otro" })).resolves.toEqual(expect.any(String));
  });

  it("deleteHoliday lo quita; uno que no existe (o de otro usuario) da su mensaje", async () => {
    const id = await addHoliday(user.client, { day: "2030-08-01", name: "Feriado demo" });
    await expect(deleteHoliday(other.client, id)).rejects.toThrow("Ese feriado ya no existe.");

    await deleteHoliday(user.client, id);
    expect((await listHolidays(user.client, 2030)).map((holiday) => holiday.day)).not.toContain("2030-08-01");
    await expect(deleteHoliday(user.client, id)).rejects.toThrow("Ese feriado ya no existe.");
  });

  it("loadUsHolidays agrega los once del año una sola vez: la segunda no agrega ni falla", async () => {
    expect(await loadUsHolidays(user.client, 2028)).toEqual({ added: 11 });
    const loaded = await listHolidays(user.client, 2028);
    expect(loaded.map(({ day, name }) => ({ day, name }))).toEqual(usBankHolidays(2028));

    expect(await loadUsHolidays(user.client, 2028)).toEqual({ added: 0 });
    expect(await listHolidays(user.client, 2028)).toEqual(loaded);
  });

  it("loadUsHolidays inserta solo los que faltan y respeta un feriado propio en uno de esos días", async () => {
    const [newYear] = usBankHolidays(2029);
    await addHoliday(user.client, { day: newYear?.day ?? "", name: "Año Nuevo (cerrado)" });

    expect(await loadUsHolidays(user.client, 2029)).toEqual({ added: 10 });
    const holidays = await listHolidays(user.client, 2029);
    expect(holidays).toHaveLength(11);
    expect(holidays[0]).toMatchObject({ day: newYear?.day, name: "Año Nuevo (cerrado)" });
  });

  it("yearsWithoutHolidays dice qué años no tienen ningún feriado", async () => {
    expect(await yearsWithoutHolidays(user.client, [2027, 2028, 2031])).toEqual([2027, 2031]);
    expect(await yearsWithoutHolidays(other.client, [2028, 2030])).toEqual([2028]);
  });
});
