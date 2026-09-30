import { beforeEach, describe, expect, it } from "vitest";
import type { IncomingOffer } from "../lib/tauri";
import { useIncomingOfferStore } from "./incomingOfferStore";

function offer(offerId: string, senderNodeId: string): IncomingOffer {
  return {
    offer_id: offerId,
    sender_node_id: senderNodeId,
    sender_device_name: "Nearby device",
    label: "photo.jpg",
    size: 128,
    blob_hash: "verified-later",
    blob_format: "raw",
    received_at_unix: 1,
    ready_to_catch: false,
  };
}

describe("incoming offer queue", () => {
  beforeEach(() => {
    useIncomingOfferStore.getState().clearIncoming();
  });

  it("removes every queued offer from a blocked identity", () => {
    const store = useIncomingOfferStore.getState();
    store.pushIncoming(offer("first", "peer-blocked"));
    store.pushIncoming(offer("other-peer", "peer-allowed"));
    store.pushIncoming(offer("second", "peer-blocked"));

    store.dismissFromPeer("peer-blocked");

    expect(useIncomingOfferStore.getState().queue.map((item) => item.offer_id))
      .toEqual(["other-peer"]);
  });
});
