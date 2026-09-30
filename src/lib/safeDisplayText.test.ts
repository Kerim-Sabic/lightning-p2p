import { describe, expect, it } from "vitest";
import { safeDisplayText } from "./safeDisplayText";

describe("safeDisplayText", () => {
  it("makes bidirectional overrides visible in untrusted labels", () => {
    expect(safeDisplayText("report\u202Egpj.exe", "Shared item")).toBe(
      "report�gpj.exe",
    );
  });

  it("collapses control characters and line breaks to one line", () => {
    expect(safeDisplayText("Kerim\u0000\nLaptop", "Nearby device")).toBe(
      "Kerim Laptop",
    );
  });

  it("preserves joined emoji and uses a fallback for empty text", () => {
    expect(safeDisplayText("👨‍💻", "Nearby device")).toBe("👨‍💻");
    expect(safeDisplayText("\u202E\u0000", "Nearby device")).toBe(
      "Nearby device",
    );
  });
});
