import { useEffect, useState } from "react";
import { lightningChatService } from "./service";
import type { LightningChatSnapshot } from "./types";

export function useLightningChat(): LightningChatSnapshot {
  const [snapshot, setSnapshot] = useState<LightningChatSnapshot>(
    lightningChatService.getSnapshot(),
  );

  useEffect(() => {
    const unsubscribe = lightningChatService.subscribe(setSnapshot);
    void lightningChatService.start();
    return unsubscribe;
  }, []);

  return snapshot;
}
