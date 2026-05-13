import { create } from "zustand";
import type { NearbyDiagnosticState } from "../lib/tauri";

interface NearbyDiagnosticStore {
  state: NearbyDiagnosticState;
  applyState: (state: NearbyDiagnosticState) => void;
  reset: () => void;
}

export const useNearbyDiagnosticStore = create<NearbyDiagnosticStore>(
  (set) => ({
    state: "searching",

    applyState: (state) =>
      set((current) => (current.state === state ? current : { state })),

    reset: () => set({ state: "searching" }),
  }),
);
