import { describe, expect, it } from "vitest";
import { formatDays } from "./days";

describe("formatDays", () => {
  it("escribe los días con un decimal como mucho y coma decimal", () => {
    expect(formatDays("3.00")).toBe("3 días");
    expect(formatDays("2.50")).toBe("2,5 días");
    expect(formatDays("2.45")).toBe("2,5 días");
    expect(formatDays("2.44")).toBe("2,4 días");
    expect(formatDays("0.00")).toBe("0 días");
  });

  it("un solo día va en singular", () => {
    expect(formatDays("1.00")).toBe("1 día");
    expect(formatDays("1.04")).toBe("1 día");
    expect(formatDays("1.05")).toBe("1,1 días");
  });
});
