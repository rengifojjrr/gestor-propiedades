import { describe, expect, test } from "vitest";
import { allocate, allocateInProportion } from "./allocate";
import { D, isMoney } from "./decimal";

/** Generador determinista (mulberry32): la misma semilla da siempre los mismos casos. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Los montos y porcentajes de prueba se arman como TEXTO a partir de enteros. */
const moneyText = (cents: number) =>
  `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
const pctText = (tenThousandths: number) =>
  `${Math.floor(tenThousandths / 10_000)}.${String(tenThousandths % 10_000).padStart(4, "0")}`;

describe("allocate (mayor resto)", () => {
  test("E1: 90,30 en 50/30/20", () => {
    expect(allocate("90.30", ["50", "30", "20"])).toEqual(["45.15", "27.09", "18.06"]);
  });

  test("E2: 32,06 en 33,3333/33,3333/33,3334", () => {
    expect(allocate("32.06", ["33.3333", "33.3333", "33.3334"])).toEqual(["10.69", "10.68", "10.69"]);
  });

  test("un centavo entre dos: se lo lleva la primera", () => {
    expect(allocate("0.01", ["50", "50"])).toEqual(["0.01", "0.00"]);
  });

  test("base negativa: se reparte el valor absoluto y se cambia el signo", () => {
    expect(allocate("-0.01", ["50", "50"])).toEqual(["-0.01", "0.00"]);
    expect(allocate("-3.20", ["50", "30", "20"])).toEqual(["-1.60", "-0.96", "-0.64"]);
    expect(allocate("-32.06", ["33.3333", "33.3333", "33.3334"])).toEqual(["-10.69", "-10.68", "-10.69"]);
  });

  test("en empate de resto gana la primera", () => {
    expect(allocate("0.02", ["25", "25", "25", "25"])).toEqual(["0.01", "0.01", "0.00", "0.00"]);
    expect(allocate("0.05", ["50", "50"])).toEqual(["0.03", "0.02"]);
    // 0,10 en 15/85 → 1,5 y 8,5 centavos: mismo resto
    expect(allocate("0.10", ["15", "85"])).toEqual(["0.02", "0.08"]);
  });

  test("el centavo que sobra va a la de mayor resto, no a la primera", () => {
    // 0,10 en 14/86 → 1,4 y 8,6 centavos
    expect(allocate("0.10", ["14", "86"])).toEqual(["0.01", "0.09"]);
    expect(allocate("1.00", ["33.3333", "33.3333", "33.3334"])).toEqual(["0.33", "0.33", "0.34"]);
  });

  test("una sola línea se lleva todo", () => {
    expect(allocate("90.30", ["100"])).toEqual(["90.30"]);
    expect(allocate("90.30", ["100.0000"])).toEqual(["90.30"]);
  });

  test("una línea de 0 % no recibe nada", () => {
    expect(allocate("0.01", ["0", "100"])).toEqual(["0.00", "0.01"]);
  });

  test('base cero: todo "0.00", sin "-0.00"', () => {
    expect(allocate("0.00", ["50", "30", "20"])).toEqual(["0.00", "0.00", "0.00"]);
    expect(allocate("-0.00", ["50", "50"])).toEqual(["0.00", "0.00"]);
  });

  test("si los porcentajes no suman exactamente 100: RangeError", () => {
    expect(() => allocate("10.00", ["50", "49.9999"])).toThrow(RangeError);
    expect(() => allocate("10.00", ["50", "50.0001"])).toThrow(RangeError);
    expect(() => allocate("10.00", ["50", "30"])).toThrow(RangeError);
    expect(() => allocate("10.00", [])).toThrow(RangeError);
  });

  test("un porcentaje negativo no se reparte aunque la suma dé 100: RangeError", () => {
    expect(() => allocate("10.00", ["150", "-50"])).toThrow(RangeError);
  });

  test("la base tiene que ser un monto con dos decimales: RangeError", () => {
    expect(() => allocate("10.005", ["50", "50"])).toThrow(RangeError);
    expect(() => allocate("10", ["50", "50"])).toThrow(RangeError);
    expect(() => allocate("abc", ["50", "50"])).toThrow(RangeError);
  });

  test("un porcentaje que no es un decimal: RangeError", () => {
    expect(() => allocate("10.00", ["50", "cincuenta"])).toThrow(RangeError);
  });
});

describe("allocate: propiedades con 2 000 casos generados", () => {
  const rnd = mulberry32(20261109);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

  /** Entre 1 y 8 porcentajes (en diezmilésimas de punto) que suman exactamente 100. */
  function randomPcts(): string[] {
    const cuts = Array.from({ length: int(0, 7) }, () => int(0, 1_000_000)).sort((x, y) => x - y);
    const edges = [0, ...cuts, 1_000_000];
    return edges.slice(1).map((edge, i) => pctText(edge - (edges[i] as number)));
  }

  const cases = Array.from({ length: 2000 }, () => ({
    base: moneyText(int(0, 9) === 0 ? int(-200, 200) : int(-50_000_000, 50_000_000)),
    pcts: randomPcts(),
  }));

  test("la suma es exactamente la base", () => {
    for (const { base, pcts } of cases) {
      const total = allocate(base, pcts).reduce((acc, amount) => acc.plus(amount), new D(0));
      expect(total.eq(base), `${base} en ${pcts.join("/")}`).toBe(true);
    }
  });

  test("cada parte es un monto canónico, una por porcentaje", () => {
    for (const { base, pcts } of cases) {
      const parts = allocate(base, pcts);
      expect(parts).toHaveLength(pcts.length);
      expect(parts.every(isMoney), `${base} en ${pcts.join("/")}`).toBe(true);
      expect(parts).not.toContain("-0.00");
    }
  });

  test("ninguna parte se aleja un centavo o más de su parte exacta, ni cambia de signo", () => {
    for (const { base, pcts } of cases) {
      const negative = new D(base).isNegative();
      allocate(base, pcts).forEach((amount, i) => {
        const exact = new D(base).times(pcts[i] as string).div(100);
        expect(new D(amount).minus(exact).abs().lt("0.01"), `${base} en ${pcts.join("/")}`).toBe(true);
        expect(negative ? new D(amount).lte(0) : new D(amount).gte(0)).toBe(true);
      });
    }
  });

  test("es determinista: los mismos datos dan el mismo reparto", () => {
    for (const { base, pcts } of cases.slice(0, 200)) {
      expect(allocate(base, pcts)).toEqual(allocate(base, pcts));
    }
  });
});

describe("allocateInProportion (mayor resto, con pesos que no suman 100)", () => {
  test("E9: 770,70 en proporción 50:30 → 481,6875 y 289,0125; el centavo va al de mayor resto", () => {
    expect(allocateInProportion("770.70", ["50", "30"])).toEqual(["481.69", "289.01"]);
  });

  test("E9b: una pérdida se reparte con signo, como E4: −29,30 en 50:30", () => {
    // 2930 centavos × 5/8 = 1831,25 y × 3/8 = 1098,75: el centavo que sobra va al de mayor resto (el segundo).
    expect(allocateInProportion("-29.30", ["50", "30"])).toEqual(["-18.31", "-10.99"]);
  });

  test("una proporción que no da decimales exactos (3/7 y 4/7) sigue sumando la base", () => {
    expect(allocateInProportion("1.00", ["30", "40"])).toEqual(["0.43", "0.57"]);
  });

  test("en empate de resto gana la primera, aunque la división no sea exacta", () => {
    // 2 centavos en 4:1:1 → 1⅓, ⅓ y ⅓: los tres con el mismo resto (⅓). El centavo que sobra es del primero.
    expect(allocateInProportion("0.02", ["4", "1", "1"])).toEqual(["0.02", "0.00", "0.00"]);
  });

  test("un peso de 0 no recibe nada", () => {
    expect(allocateInProportion("0.01", ["0", "30"])).toEqual(["0.00", "0.01"]);
  });

  test("con pesos que suman 100 da lo mismo que allocate", () => {
    expect(allocateInProportion("32.06", ["33.3333", "33.3333", "33.3334"])).toEqual(
      allocate("32.06", ["33.3333", "33.3333", "33.3334"]),
    );
  });

  test("sin ningún peso mayor que cero no hay a quién repartir: RangeError", () => {
    expect(() => allocateInProportion("10.00", [])).toThrow(RangeError);
    expect(() => allocateInProportion("10.00", ["0", "0"])).toThrow(RangeError);
  });

  test("un peso negativo, una base o un peso mal escritos: RangeError", () => {
    expect(() => allocateInProportion("10.00", ["80", "-30"])).toThrow(RangeError);
    expect(() => allocateInProportion("10", ["50", "30"])).toThrow(RangeError);
    expect(() => allocateInProportion("10.00", ["50", "treinta"])).toThrow(RangeError);
  });
});

describe("allocateInProportion: propiedades con 2 000 casos generados", () => {
  const rnd = mulberry32(20261114);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

  // Entre 1 y 6 pesos (porcentajes de un esquema, en diezmilésimas) con una suma cualquiera mayor que cero.
  const cases = Array.from({ length: 2000 }, () => {
    const weights = Array.from({ length: int(1, 6) }, () => pctText(int(0, 1_000_000)));
    if (weights.every((weight) => new D(weight).isZero())) weights[0] = "1.0000";
    return { base: moneyText(int(0, 9) === 0 ? int(-200, 200) : int(-50_000_000, 50_000_000)), weights };
  });

  test("la suma es exactamente la base; cada parte, a menos de un centavo de la exacta y con su signo", () => {
    for (const { base, weights } of cases) {
      const parts = allocateInProportion(base, weights);
      const label = `${base} en ${weights.join(":")}`;
      expect(parts).toHaveLength(weights.length);
      expect(parts.every(isMoney) && !parts.includes("-0.00"), label).toBe(true);
      expect(parts.reduce((acc, amount) => acc.plus(amount), new D(0)).eq(base), label).toBe(true);
      const total = weights.reduce((acc, weight) => acc.plus(weight), new D(0));
      parts.forEach((amount, i) => {
        const exact = new D(base).times(weights[i] as string).div(total);
        expect(new D(amount).minus(exact).abs().lt("0.01"), label).toBe(true);
        expect(new D(base).isNegative() ? new D(amount).lte(0) : new D(amount).gte(0), label).toBe(true);
      });
    }
  });
});
