import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppearanceStore } from "./appearanceStore";

const storedValues = new Map<string, string>();

describe("appearance preference", () => {
  beforeEach(() => {
    storedValues.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => storedValues.set(key, value),
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {} as DOMStringMap },
    } as unknown as Document);
    useAppearanceStore.setState({ preference: "system" });
  });

  it("applies and persists an explicit theme immediately", () => {
    useAppearanceStore.getState().setPreference("light");

    expect(useAppearanceStore.getState().preference).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(storedValues.get("lightning.appearance.preference")).toBe("light");
  });

  it("returns to the live system palette", () => {
    document.documentElement.dataset.theme = "dark";

    useAppearanceStore.getState().setPreference("system");

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(storedValues.get("lightning.appearance.preference")).toBe("system");
  });
});
