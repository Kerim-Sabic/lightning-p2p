import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type Event,
} from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeEmbeddedLightningChatPayload,
  encodeEmbeddedPrivateMessage,
  peerIdFromNostrPubkey,
} from "./protocol/embedded-message";
import {
  createLightningChatPrivateEnvelope,
  decryptLightningChatPrivateEnvelope,
} from "./protocol/private-envelope";
import { deriveRoomSecretKey } from "./protocol/room-identity";

interface FakeSubscription {
  filter: Record<string, unknown>;
  onevent: (event: Event) => void;
}

const relay = vi.hoisted(() => ({
  published: [] as Event[],
  subscriptions: [] as FakeSubscription[],
  rootSecret: "",
}));

vi.mock("nostr-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools")>();
  class FakePool {
    ensureRelay(): Promise<void> {
      return Promise.resolve();
    }
    publish(_relays: string[], event: Event): Promise<string>[] {
      relay.published.push(event);
      return [Promise.resolve("ok")];
    }
    subscribeMany(
      _relays: string[],
      filter: Record<string, unknown>,
      handlers: { onevent: (event: Event) => void },
    ): { close: () => void } {
      relay.subscriptions.push({ filter, onevent: handlers.onevent });
      return { close: () => undefined };
    }
    listConnectionStatus(): Map<string, boolean> {
      return new Map([["wss://relay.test", true]]);
    }
    destroy(): void {}
  }
  return { ...actual, SimplePool: FakePool };
});

vi.mock("../../lib/tauri", () => ({
  isNativeRuntime: () => false,
  loadLightningChatSecret: () => Promise.resolve(relay.rootSecret),
  storeLightningChatSecret: () => Promise.resolve(),
  setChatMeshNickname: () => Promise.resolve(),
  panicWipeLightningChat: () => Promise.resolve(),
}));

const { LightningChatService } = await import("./service");

const ROOM = "lightning-web";

function privateSubscriptionFor(pubkey: string): FakeSubscription {
  const subscription = relay.subscriptions.find((item) =>
    (item.filter["#p"] as string[] | undefined)?.includes(pubkey),
  );
  if (!subscription) throw new Error(`no DM subscription for ${pubkey}`);
  return subscription;
}

function roomSubscription(): FakeSubscription {
  const subscription = relay.subscriptions.find(
    (item) => item.filter["#g"] !== undefined,
  );
  if (!subscription) throw new Error("no room subscription");
  return subscription;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Lightning Chat unlinkable room identities", () => {
  let root: Uint8Array;
  let roomKey: Uint8Array;

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    relay.published.length = 0;
    relay.subscriptions.length = 0;
    root = generateSecretKey();
    relay.rootSecret = nip19.nsecEncode(root);
    roomKey = deriveRoomSecretKey(root, ROOM);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs room posts and presence with the room key, never the root key", async () => {
    const service = new LightningChatService();
    await service.start();
    await service.sendChannelMessage("hello room");
    await settle();

    const roomEvents = relay.published.filter((event) =>
      event.tags.some((tag) => tag[0] === "g"),
    );
    expect(roomEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining([20_000, 20_001]),
    );
    for (const event of roomEvents) {
      expect(event.pubkey).toBe(getPublicKey(roomKey));
      expect(event.pubkey).not.toBe(getPublicKey(root));
    }
    await service.panicWipe();
  });

  it("replies to someone met in a room from that room identity", async () => {
    const service = new LightningChatService();
    await service.start();
    const stranger = generateSecretKey();
    roomSubscription().onevent(
      finalizeEvent(
        {
          kind: 20_000,
          content: "hi",
          tags: [
            ["g", ROOM],
            ["n", "stranger"],
          ],
          created_at: Math.floor(Date.now() / 1_000),
        },
        stranger,
      ),
    );

    await service.sendPrivateMessage(getPublicKey(stranger), "psst");
    const giftWrap = relay.published.at(-1);
    if (!giftWrap) throw new Error("no gift wrap published");
    const opened = decryptLightningChatPrivateEnvelope(giftWrap, stranger);

    expect(opened.senderPubkey).toBe(getPublicKey(roomKey));
    await service.panicWipe();
  });

  it("receives DMs sent to the room identity and acknowledges them once", async () => {
    const service = new LightningChatService();
    await service.start();
    const sender = generateSecretKey();
    const roomPubkey = getPublicKey(roomKey);
    const giftWrap = createLightningChatPrivateEnvelope({
      content: encodeEmbeddedPrivateMessage({
        content: "found you in the lounge",
        messageId: "dm-1",
        senderId: peerIdFromNostrPubkey(getPublicKey(sender)),
        recipientId: peerIdFromNostrPubkey(roomPubkey),
      }),
      recipientPubkey: roomPubkey,
      senderSecretKey: sender,
    });
    const before = relay.published.length;

    privateSubscriptionFor(roomPubkey).onevent(giftWrap);
    await settle();
    privateSubscriptionFor(roomPubkey).onevent(giftWrap);
    await settle();

    expect(
      service.getSnapshot().messages.filter((message) => message.id === "dm-1"),
    ).toHaveLength(1);
    const acks = relay.published.slice(before);
    expect(acks).toHaveLength(1);
    const [ackWrap] = acks;
    if (!ackWrap) throw new Error("no acknowledgement published");
    const ack = decryptLightningChatPrivateEnvelope(ackWrap, sender);
    expect(ack.senderPubkey).toBe(roomPubkey);
    expect(decodeEmbeddedLightningChatPayload(ack.content)).toMatchObject({
      kind: "delivered",
      messageId: "dm-1",
    });
    await service.panicWipe();
  });

  it("shows replayed history from our own room key as outgoing", async () => {
    const service = new LightningChatService();
    await service.start();
    roomSubscription().onevent(
      finalizeEvent(
        {
          kind: 20_000,
          content: "sent before reload",
          tags: [
            ["g", ROOM],
            ["n", "me"],
          ],
          created_at: Math.floor(Date.now() / 1_000) - 60,
        },
        roomKey,
      ),
    );

    const replayed = service
      .getSnapshot()
      .messages.find((message) => message.content === "sent before reload");
    expect(replayed?.direction).toBe("outgoing");
    await service.panicWipe();
  });
});
