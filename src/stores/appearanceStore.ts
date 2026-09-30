import { create } from "zustand";

export type AppearancePreference = "system" | "light" | "dark";

interface AppearanceStore {
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
}

const STORAGE_KEY = "lightning.appearance.preference";

function isAppearancePreference(
  value: string | null,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readPreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppearancePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function applyPreference(preference: AppearancePreference): void {
  if (typeof document === "undefined") return;
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preference;
  }
}

const initialPreference = readPreference();
applyPreference(initialPreference);

export const useAppearanceStore = create<AppearanceStore>((set) => ({
  preference: initialPreference,

  setPreference: (preference) => {
    applyPreference(preference);
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // The current session still follows the selected appearance.
    }
    set({ preference });
  },
}));
