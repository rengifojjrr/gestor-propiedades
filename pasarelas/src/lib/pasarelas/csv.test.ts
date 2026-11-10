import { describe, expect, test } from "vitest";
import { CSV_ES, CSV_STD, toCsv, type CsvFormat } from "./csv";

const BOM = "\uFEFF";

/** Una sola celda de texto bajo el encabezado «x», sin el encabezado ni el fin de línea. */
const celda = (text: string | null, fmt: CsvFormat = CSV_STD): string => {
  const csv = toCsv(["x"], [[text]], fmt);
  return csv.slice(csv.indexOf("\r\n") + 2, -2);
};

/** Lo mismo, con la celda en una columna de dinero. */
const dinero = (value: string | null, fmt: CsvFormat): string => {
  const csv = toCsv(["x"], [[value]], fmt, [0]);
  return csv.slice(csv.indexOf("\r\n") + 2, -2);
};

describe("formatos", () => {
  test("CSV_ES: punto y coma, coma decimal y BOM (lo que abre bien una hoja de cálculo en español)", () => {
    expect(CSV_ES).toEqual({ delimiter: ";", decimal: ",", bom: true });
  });

  test("CSV_STD: coma, punto decimal y sin BOM", () => {
    expect(CSV_STD).toEqual({ delimiter: ",", decimal: ".", bom: false });
  });
});

describe("toCsv: estructura", () => {
  test("encabezado y filas separados por el delimitador; cada línea termina en \\r\\n, también la última", () => {
    const filas = [
      ["2026-11-02", "Tienda Demo"],
      ["2026-11-03", "Escuela Demo"],
    ];
    expect(toCsv(["Fecha", "Empresa"], filas, CSV_STD)).toBe(
      "Fecha,Empresa\r\n2026-11-02,Tienda Demo\r\n2026-11-03,Escuela Demo\r\n",
    );
  });

  test("sin filas queda solo el encabezado", () => {
    expect(toCsv(["Fecha", "Empresa"], [], CSV_STD)).toBe("Fecha,Empresa\r\n");
  });

  test("CSV_ES empieza con el BOM y separa con punto y coma; CSV_STD no lleva BOM", () => {
    expect(toCsv(["a", "b"], [["1", "2"]], CSV_ES)).toBe(`${BOM}a;b\r\n1;2\r\n`);
    expect(toCsv(["a", "b"], [["1", "2"]], CSV_STD).startsWith(BOM)).toBe(false);
  });

  test("null es una celda vacía", () => {
    expect(toCsv(["a", "b", "c"], [[null, "x", null]], CSV_STD)).toBe("a,b,c\r\n,x,\r\n");
    expect(toCsv(["a", "b"], [[null, null]], CSV_ES, [1])).toBe(`${BOM}a;b\r\n;\r\n`);
  });
});

describe("toCsv: comillas", () => {
  test("una celda con comillas va entre comillas dobles y las de adentro se duplican", () => {
    expect(celda('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(celda('"')).toBe('""""');
  });

  test("una celda con el delimitador va entre comillas; con el otro delimitador, no", () => {
    expect(celda("Demo, S. A.", CSV_STD)).toBe('"Demo, S. A."');
    expect(celda("Demo, S. A.", CSV_ES)).toBe("Demo, S. A.");
    expect(celda("uno;dos", CSV_ES)).toBe('"uno;dos"');
    expect(celda("uno;dos", CSV_STD)).toBe("uno;dos");
  });

  test("una celda con salto de línea o retorno de carro va entre comillas", () => {
    expect(celda("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(celda("línea 1\r\nlínea 2")).toBe('"línea 1\r\nlínea 2"');
    expect(celda("antes\rdespués")).toBe('"antes\rdespués"');
  });

  test("lo demás va tal cual, con sus espacios y acentos", () => {
    expect(celda(" Año 2026 · café ")).toBe(" Año 2026 · café ");
    expect(celda("")).toBe("");
  });
});

describe("toCsv: protección contra fórmulas", () => {
  test.each([
    ["=1+1", "'=1+1"],
    ["-cmd", "'-cmd"],
    ["+1", "'+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1+1", "'\t=1+1"],
  ])("al texto %j se le antepone un apóstrofo", (text, expected) => {
    expect(celda(text)).toBe(expected);
  });

  test("al texto que empieza por retorno de carro se le antepone el apóstrofo y además va entre comillas", () => {
    expect(celda("\r=1+1")).toBe("\"'\r=1+1\"");
  });

  test("el apóstrofo va dentro de las comillas cuando la celda también las necesita", () => {
    expect(celda('=HYPERLINK("http://example.com","x")')).toBe('"\'=HYPERLINK(""http://example.com"",""x"")"');
    expect(celda("=1;2", CSV_ES)).toBe('"\'=1;2"');
  });

  test("solo importa el primer carácter", () => {
    expect(celda("a=b")).toBe("a=b");
    expect(celda("1+1")).toBe("1+1");
    expect(celda("uno-dos")).toBe("uno-dos");
    expect(celda("correo@example.com")).toBe("correo@example.com");
  });

  test("un monto negativo en una columna de texto es texto: lleva apóstrofo y no cambia el punto", () => {
    expect(celda("-3.20", CSV_ES)).toBe("'-3.20");
  });

  test("el encabezado se trata como texto, aunque su columna sea de dinero", () => {
    expect(toCsv(["=Total", "-3.20"], [], CSV_ES, [1])).toBe(`${BOM}'=Total;'-3.20\r\n`);
  });
});

describe("toCsv: columnas de dinero", () => {
  test("'-3.20' sale -3,20 en CSV_ES, sin apóstrofo", () => {
    expect(dinero("-3.20", CSV_ES)).toBe("-3,20");
  });

  test("en CSV_STD el monto no se toca", () => {
    expect(dinero("-3.20", CSV_STD)).toBe("-3.20");
    expect(dinero("1234.56", CSV_STD)).toBe("1234.56");
  });

  test("solo cambia el separador decimal: no agrega miles", () => {
    expect(dinero("1234567.89", CSV_ES)).toBe("1234567,89");
    expect(dinero("0.00", CSV_ES)).toBe("0,00");
  });

  test("si la coma decimal es también el delimitador, el monto va entre comillas", () => {
    const comaYComa: CsvFormat = { delimiter: ",", decimal: ",", bom: false };
    expect(dinero("-3.20", comaYComa)).toBe('"-3,20"');
  });

  test("lo que no es un monto no se libra de la protección por estar en una columna de dinero", () => {
    expect(dinero("=1+1", CSV_ES)).toBe("'=1+1");
    expect(dinero("-cmd", CSV_ES)).toBe("'-cmd");
    expect(dinero("-3.20+1.10", CSV_ES)).toBe("'-3.20+1.10");
  });

  test("las columnas de dinero se eligen por su posición; las demás son texto", () => {
    const csv = toCsv(
      ["Fecha", "Empresa", "Bruto", "Neto", "Nota"],
      [
        ["2026-11-02", "Tienda Demo", "100.00", "90.30", null],
        ["2026-11-03", "Escuela; Demo", "0.00", "-3.20", "-reembolso total"],
      ],
      CSV_ES,
      [2, 3],
    );
    expect(csv).toBe(
      `${BOM}Fecha;Empresa;Bruto;Neto;Nota\r\n` +
        "2026-11-02;Tienda Demo;100,00;90,30;\r\n" +
        "2026-11-03;\"Escuela; Demo\";0,00;-3,20;'-reembolso total\r\n",
    );
  });
});
