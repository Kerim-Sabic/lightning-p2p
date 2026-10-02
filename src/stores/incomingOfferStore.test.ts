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
    useIncomingOfferStore.setState({ outbound: {} });
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

  it("removes an expired head offer so the next sender can be reviewed", () => {
    const store = useIncomingOfferStore.getState();
    store.pushIncoming(offer("expired", "peer-1"));
    store.pushIncoming(offer("next", "peer-2"));

    store.dismissIncoming("expired", "peer-1");

    expect(useIncomingOfferStore.getState().queue.map((item) => item.offer_id))
      .toEqual(["next"]);
  });

  it("keeps colliding offer identifiers isolated by sender identity", () => {
    const store = useIncomingOfferStore.getState();
    store.pushIncoming(offer("shared-id", "peer-a"));
    store.pushIncoming(offer("shared-id", "peer-b"));
    store.pushIncoming(offer("shared-id", "peer-a"));

    expect(useIncomingOfferStore.getState().queue).toHaveLength(2);
    useIncomingOfferStore.getState().dismissIncoming("shared-id", "peer-a");
    expect(useIncomingOfferStore.getState().queue.map((item) => item.sender_node_id))
      .toEqual(["peer-b"]);
  });

  it("does not revive a dismissed offer from a late startup snapshot", () => {
    const store = useIncomingOfferStore.getState();
    store.pushIncoming(offer("already-closed", "peer-a"));
    store.dismissIncoming("already-closed", "peer-a");

    useIncomingOfferStore
      .getState()
      .applyIncomingSnapshot([offer("already-closed", "peer-a")]);

    expect(useIncomingOfferStore.getState().queue).toEqual([]);
  });

  it("merges a pending-offer snapshot without duplicating live events", () => {
    const store = useIncomingOfferStore.getState();
    store.pushIncoming(offer("live", "peer-a"));

    useIncomingOfferStore.getState().applyIncomingSnapshot([
      offer("missed", "peer-b"),
      offer("live", "peer-a"),
    ]);

    expect(
      useIncomingOfferStore
        .getState()
        .queue.map((item) => [item.sender_node_id, item.offer_id]),
    ).toEqual([
      ["peer-a", "live"],
      ["peer-b", "missed"],
    ]);
  });

  it("bounds outbound offer history while retaining the most recent results", () => {
    const store = useIncomingOfferStore.getState();
    for (let index = 0; index < 256; index += 1) {
      store.recordOutbound({
        offerId: `offer-${index}`,
        receiverNodeId: `peer-${index}`,
        status: "accepted",
        message: null,
        updatedAt: index,
      });
    }

    store.applyOfferResolved({
      offer_id: "offer-newest",
      receiver_node_id: "peer-newest",
      outcome: "accepted",
    });

    const outbound = useIncomingOfferStore.getState().outbound;
    expect(Object.keys(outbound)).toHaveLength(256);
    expect(outbound["offer-0"]).toBeUndefined();
    expect(outbound["offer-newest"]?.receiverNodeId).toBe("peer-newest");
  });
});
