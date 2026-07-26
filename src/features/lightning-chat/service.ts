import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
  type Event,
} from "nostr-tools";
import type { SubCloser } from "nostr-tools/abstract-pool";
import {
  getNearbyDevices,
  getChatMeshStatus,
  getNodeId,
  isNativeRuntime,
  loadLightningChatSecret,
  onChatMessage,
  onChatMeshEvent,
  panicWipeLightningChat,
  createChatMeshGroup,
  renderChatTrustQr,
  sendChatMeshGroupMessage,
  sendChatMeshMedia,
  sendChatMeshMessage,
  sendChatMeshPrivateMessage,
  sendChatMessage,
  setChatMeshNickname,
  startBleDiscovery,
  storeLightningChatSecret,
  verifyChatTrustQr,
  type ChatMeshEvent,
  type ChatMessage,
  type ChatTrustQr,
} from "../../lib/tauri";
import {
  DEFAULT_LIGHTNING_CHAT_CHANNEL,
  WEB_LIGHTNING_CHAT_CHANNEL,
  type LightningChatChannel,
  type LightningChatIdentity,
  type LightningChatMessage,
  type LightningChatSnapshot,
} from "./types";
import {
  decodeEmbeddedLightningChatPayload,
  encodeEmbeddedAcknowledgement,
  encodeEmbeddedPrivateMessage,
  peerIdFromNostrPubkey,
} from "./protocol/embedded-message";
import {
  createLightningChatPrivateEnvelope,
  decryptLightningChatPrivateEnvelope,
} from "./protocol/private-envelope";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://offchain.pub",
] as const;
const HISTORY_SECONDS = 6 * 60 * 60;
const NICKNAME_KEY = "lightning-chat.nickname";
const MAX_MESH_MEDIA_BYTES = 512 * 1024;
const FAVORITES_KEY = "lightning-chat.favorites";
const BLOCKED_KEY = "lightning-chat.blocked";
const PRESENCE_INTERVAL_MS = 30_000;

type SnapshotListener = (snapshot: LightningChatSnapshot) => void;

export class LightningChatService {
  private pool: SimplePool | null = null;
  private secretKey: Uint8Array | null = null;
  private channelSubscription: SubCloser | null = null;
  private privateSubscription: SubCloser | null = null;
  private listeners = new Set<SnapshotListener>();
  private seenMessageIds = new Set<string>();
  private readAcknowledgedIds = new Set<string>();
  private nearbyTimer: number | null = null;
  private presenceTimer: number | null = null;
  private stopNearbyMessages: (() => void) | null = null;
  private stopMeshMessages: (() => void) | null = null;
  private snapshot: LightningChatSnapshot = {
    status: "starting",
    identity: null,
    active_channel: isNativeRuntime()
      ? DEFAULT_LIGHTNING_CHAT_CHANNEL
      : WEB_LIGHTNING_CHAT_CHANNEL,
    relays: [...DEFAULT_RELAYS],
    connected_relays: 0,
    messages: [],
    peers: [],
    groups: [],
    mesh_peer_id: null,
    mesh_links: 0,
    error: null,
  };

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): LightningChatSnapshot {
    return this.snapshot;
  }

  async start(): Promise<void> {
    if (this.pool) return;
    this.update({ status: "connecting", error: null });
    try {
      const secretKey = await this.loadSecretKey();
      const pool = new SimplePool({ enableReconnect: true });
      this.pool = pool;
      this.secretKey = secretKey;
      await Promise.allSettled(
        DEFAULT_RELAYS.map((relay) =>
          pool.ensureRelay(relay, { connectionTimeout: 6_000 }),
        ),
      );
      const identity = this.createIdentity(secretKey);
      this.update({
        identity,
        status: "online",
        connected_relays: connectedRelayCount(pool),
      });
      await setChatMeshNickname(identity.nickname).catch(() => undefined);
      this.subscribeToPrivateMessages(identity.pubkey);
      if (this.snapshot.active_channel.geohash) {
        this.joinChannel(this.snapshot.active_channel);
      }
      if (isNativeRuntime()) {
        try {
          await this.startNearbyChat();
        } catch {
          // Relay chat remains available while the local node is warming.
        }
      }
    } catch (cause) {
      this.update({
        status: "offline",
        error: errorMessage(cause, "Lightning Chat could not connect."),
      });
    }
  }

  setNickname(nickname: string): void {
    const normalized = nickname.trim().slice(0, 32) || "anonymous";
    localStorage.setItem(NICKNAME_KEY, normalized);
    if (this.snapshot.identity) {
      this.update({
        identity: { ...this.snapshot.identity, nickname: normalized },
      });
    }
    void setChatMeshNickname(normalized).catch(() => undefined);
  }

  joinChannel(channel: LightningChatChannel): void {
    this.update({ active_channel: channel, messages: [] });
    this.seenMessageIds.clear();
    if (channel.geohash) {
      this.subscribeToChannel(channel);
      void this.startPresence(channel);
    } else {
      this.channelSubscription?.close();
      this.channelSubscription = null;
      this.stopPresence();
    }
  }

  async sendChannelMessage(content: string): Promise<void> {
    if (!this.snapshot.active_channel.geohash) {
      await this.sendNearbyBroadcast(content);
      return;
    }
    const pool = this.requirePool();
    const body = normalizedMessage(content);
    const event = finalizeEvent(
      {
        kind: 20_000,
        content: body,
        tags: channelTags(
          this.snapshot.active_channel,
          this.snapshot.identity?.nickname ?? "anonymous",
        ),
        created_at: Math.floor(Date.now() / 1_000),
      },
      this.requireSecretKey(),
    );
    const optimistic = this.channelEventToMessage(event, true);
    this.appendMessage(optimistic);
    try {
      await publishToAnyRelay(pool, event);
      this.replaceDelivery(optimistic.id, "sent");
    } catch (cause) {
      this.replaceDelivery(optimistic.id, "failed");
      throw new Error(errorMessage(cause, "No relay accepted the message."), {
        cause,
      });
    }
  }

  async sendPrivateMessage(
    recipient: string,
    content: string,
  ): Promise<string> {
    const pool = this.requirePool();
    const secretKey = this.requireSecretKey();
    const recipientPubkey = parseRecipientPubkey(recipient);
    const senderPubkey = this.snapshot.identity?.pubkey;
    if (!senderPubkey)
      throw new Error("Lightning Chat identity is unavailable.");
    const messageId = crypto.randomUUID();
    const body = encodeEmbeddedPrivateMessage({
      content: normalizedPrivateMessage(content),
      messageId,
      senderId: peerIdFromNostrPubkey(senderPubkey),
      recipientId: peerIdFromNostrPubkey(recipientPubkey),
    });
    const message: LightningChatMessage = {
      id: messageId,
      conversation_id: `private:${recipientPubkey}`,
      author_id: senderPubkey,
      author_name: this.snapshot.identity?.nickname ?? "me",
      content: content.trim(),
      created_at: Math.floor(Date.now() / 1_000),
      direction: "outgoing",
      delivery: "sending",
      transport: "nostr",
    };
    this.appendMessage(message);
    try {
      await publishPrivateEnvelope(pool, {
        content: body,
        recipientPubkey,
        senderSecretKey: secretKey,
      });
      this.replaceDelivery(messageId, "sent");
    } catch (cause) {
      this.replaceDelivery(messageId, "failed");
      throw new Error(
        errorMessage(cause, "Private message was not accepted."),
        { cause },
      );
    }
    return message.conversation_id;
  }

  async sendNearbyMessage(nodeId: string, content: string): Promise<void> {
    const peer = this.snapshot.peers.find((item) => item.id === nodeId);
    if (peer?.mesh_id) {
      const messageId = crypto.randomUUID();
      const body = normalizedMessage(content);
      const optimistic: LightningChatMessage = {
        id: messageId,
        conversation_id: `nearby:${peer.id}`,
        author_id: this.snapshot.mesh_peer_id ?? "local",
        author_name: this.snapshot.identity?.nickname ?? "me",
        content: body,
        created_at: Math.floor(Date.now() / 1_000),
        direction: "outgoing",
        delivery: "sending",
        transport: "ble_mesh",
      };
      this.appendMessage(optimistic);
      try {
        await sendChatMeshPrivateMessage(peer.mesh_id, body, messageId);
        this.replaceDelivery(messageId, "sent");
      } catch (cause) {
        this.replaceDelivery(messageId, "failed");
        throw cause;
      }
      return;
    }
    const sent = await sendChatMessage(nodeId, normalizedMessage(content));
    this.appendMessage(irohMessage(sent, nodeId, true));
  }

  async sendMedia(
    peerId: string | undefined,
    file: File,
    voice = false,
  ): Promise<void> {
    if (file.size > MAX_MESH_MEDIA_BYTES) {
      throw new Error(
        "Nearby chat attachments are limited to 512 KiB. Use Lightning Transfer for larger files.",
      );
    }
    const peer = peerId
      ? this.snapshot.peers.find((item) => item.id === peerId)
      : undefined;
    const dataBase64 = await fileToBase64(file);
    await sendChatMeshMedia({
      ...(peer?.mesh_id ? { peerId: peer.mesh_id } : {}),
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      dataBase64,
      voice,
    });
    this.appendMessage({
      id: crypto.randomUUID(),
      conversation_id: peer
        ? `nearby:${peer.id}`
        : "channel:global",
      author_id: this.snapshot.mesh_peer_id ?? "local",
      author_name: this.snapshot.identity?.nickname ?? "me",
      content: voice ? "Voice note" : `Shared ${file.name}`,
      created_at: Math.floor(Date.now() / 1_000),
      direction: "outgoing",
      delivery: "sent",
      transport: "ble_mesh",
      media: {
        kind: file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("audio/") || voice
            ? "audio"
            : "file",
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        data_base64: dataBase64,
      },
    });
  }

  async createGroup(name: string, peerIds: string[]): Promise<string> {
    const meshIds = peerIds
      .map((id) => this.snapshot.peers.find((peer) => peer.id === id)?.mesh_id)
      .filter((id): id is string => Boolean(id));
    const group = await createChatMeshGroup(name, meshIds);
    this.update({
      groups: [
        ...this.snapshot.groups.filter((item) => item.id !== group.id),
        group,
      ],
    });
    return group.id;
  }

  async sendGroupMessage(groupId: string, content: string): Promise<void> {
    const event = await sendChatMeshGroupMessage(
      groupId,
      normalizedMessage(content),
      crypto.randomUUID(),
    );
    this.appendMessage(meshEventToMessage(event, this.snapshot.mesh_peer_id));
  }

  async createTrustQr(): Promise<ChatTrustQr> {
    return renderChatTrustQr(
      this.snapshot.identity?.nickname ?? "anonymous",
      this.snapshot.identity?.npub,
    );
  }

  async verifyTrust(value: string): Promise<string> {
    const peer = await verifyChatTrustQr(value);
    return `${peer.nickname} · ${peer.fingerprint.slice(0, 16)}…`;
  }

  toggleFavorite(peerId: string): void {
    const peers = this.snapshot.peers.map((peer) =>
      peer.id === peerId ? { ...peer, is_favorite: !peer.is_favorite } : peer,
    );
    persistPeerSet(
      FAVORITES_KEY,
      peers.filter((peer) => peer.is_favorite).map((peer) => peer.id),
    );
    this.update({ peers });
  }

  blockPeer(peerId: string): void {
    const peers = this.snapshot.peers.map((peer) =>
      peer.id === peerId ? { ...peer, is_blocked: !peer.is_blocked } : peer,
    );
    persistPeerSet(
      BLOCKED_KEY,
      peers.filter((peer) => peer.is_blocked).map((peer) => peer.id),
    );
    this.update({ peers });
  }

  clearMessages(conversationId?: string): void {
    const messages = conversationId
      ? this.snapshot.messages.filter(
          (message) => message.conversation_id !== conversationId,
        )
      : [];
    this.seenMessageIds = new Set(messages.map((message) => message.id));
    this.update({ messages });
  }

  async markConversationRead(conversationId: string): Promise<void> {
    if (!conversationId.startsWith("private:")) return;
    const recipientPubkey = conversationId.slice("private:".length);
    const unread = this.snapshot.messages.filter(
      (message) =>
        message.conversation_id === conversationId &&
        message.direction === "incoming" &&
        !this.readAcknowledgedIds.has(message.id),
    );
    for (const message of unread) {
      await this.sendAcknowledgement(recipientPubkey, message.id, "read");
      this.readAcknowledgedIds.add(message.id);
    }
  }

  async panicWipe(): Promise<void> {
    this.channelSubscription?.close();
    this.channelSubscription = null;
    this.privateSubscription?.close();
    this.privateSubscription = null;
    this.pool?.destroy();
    this.pool = null;
    this.secretKey = null;
    if (this.nearbyTimer !== null) window.clearInterval(this.nearbyTimer);
    this.nearbyTimer = null;
    this.stopPresence();
    this.stopNearbyMessages?.();
    this.stopNearbyMessages = null;
    this.stopMeshMessages?.();
    this.stopMeshMessages = null;
    this.seenMessageIds.clear();
    this.readAcknowledgedIds.clear();
    localStorage.removeItem(NICKNAME_KEY);
    localStorage.removeItem(FAVORITES_KEY);
    localStorage.removeItem(BLOCKED_KEY);
    await panicWipeLightningChat();
    this.snapshot = {
      ...this.snapshot,
      status: "offline",
      identity: null,
      messages: [],
      peers: [],
      groups: [],
      mesh_peer_id: null,
      mesh_links: 0,
      connected_relays: 0,
      error: null,
    };
    this.emit();
  }

  private async loadSecretKey(): Promise<Uint8Array> {
    const storedSecret = await loadLightningChatSecret();
    if (storedSecret) return decodeSecretKey(storedSecret);
    const secretKey = generateSecretKey();
    await storeLightningChatSecret(nip19.nsecEncode(secretKey));
    return secretKey;
  }

  private async startNearbyChat(): Promise<void> {
    const nodeId = await getNodeId();
    if (nodeId !== "desktop-runtime-required") {
      await startBleDiscovery(nodeId);
    }
    await this.refreshNearbyPeers();
    this.nearbyTimer = window.setInterval(() => {
      void this.refreshNearbyPeers();
    }, 5_000);
    const subscription = onChatMessage((message) => {
      const blocked = this.snapshot.peers.some(
        (peer) => peer.id === message.sender_node_id && peer.is_blocked,
      );
      if (!blocked) {
        this.appendMessage(
          irohMessage(message, message.sender_node_id, false, true),
        );
      }
    });
    this.stopNearbyMessages = await subscription;
    this.stopMeshMessages = await onChatMeshEvent((event) => {
      this.receiveMeshEvent(event);
    });
  }

  private async refreshNearbyPeers(): Promise<void> {
    const [devices, meshStatus] = await Promise.all([
      getNearbyDevices(),
      getChatMeshStatus().catch(() => null),
    ]);
    const existing = new Map(
      this.snapshot.peers.map((peer) => [peer.id, peer]),
    );
    const favorites = loadPeerSet(FAVORITES_KEY);
    const blocked = loadPeerSet(BLOCKED_KEY);
    const irohPeers = devices.map((device) => {
      const known = existing.get(device.node_id);
      return {
        id: device.node_id,
        label: device.device_name,
        node_id: device.node_id,
        is_favorite: known?.is_favorite ?? favorites.has(device.node_id),
        is_blocked: known?.is_blocked ?? blocked.has(device.node_id),
        is_nearby: true,
      };
    });
    const meshPeers = (meshStatus?.peers ?? []).map((peer) => {
      const id = `mesh:${peer.id}`;
      const known = existing.get(id);
      return {
        id,
        label: peer.nickname,
        mesh_id: peer.id,
        fingerprint: peer.fingerprint,
        noise_ready: peer.noise_ready,
        is_favorite: known?.is_favorite ?? favorites.has(id),
        is_blocked: known?.is_blocked ?? blocked.has(id),
        is_nearby: true,
      };
    });
    const irohNodeIds = new Set(irohPeers.map((peer) => peer.node_id));
    const peers = [
      ...irohPeers,
      ...meshPeers.filter((peer) => !irohNodeIds.has(peer.mesh_id)),
    ];
    this.update({
      peers,
      groups: meshStatus?.groups ?? this.snapshot.groups,
      mesh_peer_id: meshStatus?.peer_id ?? null,
      mesh_links: meshStatus?.connected_links ?? 0,
    });
  }

  private async sendNearbyBroadcast(content: string): Promise<void> {
    const body = normalizedMessage(content);
    try {
      const event = await sendChatMeshMessage(body);
      this.appendMessage(
        meshEventToMessage(event, this.snapshot.mesh_peer_id, true),
      );
      return;
    } catch {
      // Fall through to direct iroh fan-out when the radio mesh has no link.
    }
    const targets = this.snapshot.peers.filter((peer) => !peer.is_blocked);
    if (targets.length === 0) {
      throw new Error("No nearby Lightning Chat peers are connected.");
    }
    const id = crypto.randomUUID();
    const optimistic: LightningChatMessage = {
      id,
      conversation_id: "channel:global",
      author_id: this.snapshot.identity?.pubkey ?? "local",
      author_name: this.snapshot.identity?.nickname ?? "me",
      content: body,
      created_at: Math.floor(Date.now() / 1_000),
      direction: "outgoing",
      delivery: "sending",
      transport: "iroh",
    };
    this.appendMessage(optimistic);
    const results = await Promise.allSettled(
      targets.map((peer) => sendChatMessage(peer.id, body)),
    );
    this.replaceDelivery(
      id,
      results.some((result) => result.status === "fulfilled")
        ? "sent"
        : "failed",
    );
  }

  private receiveMeshEvent(event: ChatMeshEvent): void {
    if (event.kind === "peer" || event.kind === "group_update") {
      void this.refreshNearbyPeers();
      return;
    }
    if (event.kind === "delivered" || event.kind === "read") {
      this.replaceDelivery(event.id, event.kind);
      return;
    }
    const blocked = this.snapshot.peers.some(
      (peer) => peer.mesh_id === event.sender_id && peer.is_blocked,
    );
    if (!blocked) {
      this.appendMessage(meshEventToMessage(event, this.snapshot.mesh_peer_id));
    }
  }

  private createIdentity(secretKey: Uint8Array): LightningChatIdentity {
    const pubkey = getPublicKey(secretKey);
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
      nickname: localStorage.getItem(NICKNAME_KEY) || "anonymous",
    };
  }

  private subscribeToChannel(channel: LightningChatChannel): void {
    const pool = this.requirePool();
    this.channelSubscription?.close();
    const filter = {
      kinds: [20_000, 1],
      since: Math.floor(Date.now() / 1_000) - HISTORY_SECONDS,
      ...(channel.geohash ? { "#g": [channel.geohash] } : {}),
    };
    this.channelSubscription = pool.subscribeMany([...DEFAULT_RELAYS], filter, {
      onevent: (event) => {
        if (!matchesChannel(event, channel)) return;
        this.appendMessage(this.channelEventToMessage(event, false));
      },
    });
  }

  private async startPresence(channel: LightningChatChannel): Promise<void> {
    this.stopPresence();
    const publish = async (): Promise<void> => {
      if (!channel.geohash || this.snapshot.active_channel.id !== channel.id) {
        return;
      }
      const event = finalizeEvent(
        {
          kind: 20_001,
          content: "",
          tags: [["g", channel.geohash]],
          created_at: Math.floor(Date.now() / 1_000),
        },
        this.requireSecretKey(),
      );
      await publishToAnyRelay(this.requirePool(), event);
    };
    try {
      await publish();
    } catch {
      // Presence is best effort; room messaging remains usable.
    }
    this.presenceTimer = window.setInterval(() => {
      void publish().catch(() => undefined);
    }, PRESENCE_INTERVAL_MS);
  }

  private stopPresence(): void {
    if (this.presenceTimer !== null) window.clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  private subscribeToPrivateMessages(pubkey: string): void {
    const pool = this.requirePool();
    this.privateSubscription?.close();
    this.privateSubscription = pool.subscribeMany(
      [...DEFAULT_RELAYS],
      {
        kinds: [1_059],
        "#p": [pubkey],
        since: Math.floor(Date.now() / 1_000) - HISTORY_SECONDS,
      },
      {
        onevent: (event) => {
          void this.receivePrivateEnvelope(event);
        },
      },
    );
  }

  private async receivePrivateEnvelope(giftWrap: Event): Promise<void> {
    try {
      const secretKey = this.requireSecretKey();
      const decrypted = decryptLightningChatPrivateEnvelope(
        giftWrap,
        secretKey,
      );
      const embedded = decodeEmbeddedLightningChatPayload(decrypted.content);
      if (embedded.kind !== "message") {
        this.replaceDelivery(
          embedded.messageId,
          embedded.kind === "read" ? "read" : "delivered",
        );
        return;
      }
      const message: LightningChatMessage = {
        id: embedded.messageId,
        conversation_id: `private:${decrypted.senderPubkey}`,
        author_id: decrypted.senderPubkey,
        author_name: decrypted.senderPubkey.slice(0, 12),
        content: embedded.content,
        created_at: Math.floor(embedded.timestamp / 1_000),
        direction: "incoming",
        delivery: "delivered",
        transport: "nostr",
      };
      this.appendMessage(message);
      await this.sendAcknowledgement(
        decrypted.senderPubkey,
        embedded.messageId,
        "delivered",
      );
    } catch {
      // Invalid, unauthenticated, or unrelated gift wraps are ignored.
    }
  }

  private async sendAcknowledgement(
    recipientPubkey: string,
    messageId: string,
    kind: "delivered" | "read",
  ): Promise<void> {
    const senderPubkey = this.snapshot.identity?.pubkey;
    if (!senderPubkey) return;
    const content = encodeEmbeddedAcknowledgement({
      kind,
      messageId,
      senderId: peerIdFromNostrPubkey(senderPubkey),
      recipientId: peerIdFromNostrPubkey(recipientPubkey),
    });
    await publishPrivateEnvelope(this.requirePool(), {
      content,
      recipientPubkey,
      senderSecretKey: this.requireSecretKey(),
    });
  }

  private channelEventToMessage(
    event: Event,
    outgoing: boolean,
  ): LightningChatMessage {
    const nickname =
      event.tags.find((tag) => tag[0] === "n")?.[1] ||
      event.pubkey.slice(0, 12);
    const id = event.id || crypto.randomUUID();
    return {
      id,
      conversation_id: `channel:${this.snapshot.active_channel.id}`,
      author_id: event.pubkey || this.snapshot.identity?.pubkey || "pending",
      author_name: nickname,
      content: event.content,
      created_at: event.created_at || Math.floor(Date.now() / 1_000),
      direction: outgoing ? "outgoing" : "incoming",
      delivery: outgoing ? "sending" : "delivered",
      transport: "nostr",
    };
  }

  private appendMessage(message: LightningChatMessage): void {
    if (this.seenMessageIds.has(message.id)) return;
    this.seenMessageIds.add(message.id);
    const messages = [...this.snapshot.messages, message]
      .sort((left, right) => left.created_at - right.created_at)
      .slice(-1_000);
    this.update({ messages });
  }

  private replaceDelivery(
    id: string,
    delivery: LightningChatMessage["delivery"],
  ): void {
    this.update({
      messages: this.snapshot.messages.map((message) =>
        message.id === id ? { ...message, delivery } : message,
      ),
    });
  }

  private requirePool(): SimplePool {
    if (!this.pool) throw new Error("Lightning Chat is not connected.");
    return this.pool;
  }

  private requireSecretKey(): Uint8Array {
    if (!this.secretKey) throw new Error("Private messaging is not ready.");
    return this.secretKey;
  }

  private update(patch: Partial<LightningChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function normalizedMessage(content: string): string {
  const body = content.trim();
  if (!body || body.length > 8_000) {
    throw new Error("Messages must be between 1 and 8,000 characters.");
  }
  return body;
}

function normalizedPrivateMessage(content: string): string {
  const body = content.trim();
  if (!body || new TextEncoder().encode(body).length > 255) {
    throw new Error(
      "Lightning Chat private messages must be 1–255 UTF-8 bytes.",
    );
  }
  return body;
}

function channelTags(
  channel: LightningChatChannel,
  nickname: string,
): string[][] {
  const tags = [["n", nickname]];
  if (channel.geohash) tags.unshift(["g", channel.geohash]);
  return tags;
}

function matchesChannel(event: Event, channel: LightningChatChannel): boolean {
  const geohash = event.tags.find((tag) => tag[0] === "g")?.[1] ?? "";
  return channel.geohash ? geohash === channel.geohash : geohash === "";
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function decodeSecretKey(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error("Lightning Chat key is not a valid nsec.");
  }
  return decoded.data;
}

function parseRecipientPubkey(recipient: string): string {
  const normalized = recipient.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) return normalized.toLowerCase();
  const decoded = nip19.decode(normalized);
  if (decoded.type !== "npub") {
    throw new Error("Enter an npub or 64-character public key.");
  }
  return decoded.data;
}

async function publishPrivateEnvelope(
  pool: SimplePool,
  input: {
    content: string;
    recipientPubkey: string;
    senderSecretKey: Uint8Array;
  },
): Promise<void> {
  const giftWrap = createLightningChatPrivateEnvelope(input);
  await publishToAnyRelay(pool, giftWrap);
}

async function publishToAnyRelay(
  pool: SimplePool,
  event: Event,
): Promise<void> {
  await Promise.any(
    pool.publish([...DEFAULT_RELAYS], event, { maxWait: 6_000 }),
  );
}

function connectedRelayCount(pool: SimplePool): number {
  return Array.from(pool.listConnectionStatus().values()).filter(Boolean)
    .length;
}

function irohMessage(
  message: ChatMessage,
  peerId: string,
  outgoing: boolean,
  channel = false,
): LightningChatMessage {
  return {
    id: message.id,
    conversation_id: channel ? "channel:global" : `nearby:${peerId}`,
    author_id: message.sender_node_id,
    author_name: message.sender_name,
    content: message.body,
    created_at: message.sent_at,
    direction: outgoing ? "outgoing" : "incoming",
    delivery: outgoing ? "sent" : "delivered",
    transport: "iroh",
  };
}

function loadPeerSet(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistPeerSet(key: string, values: string[]): void {
  localStorage.setItem(key, JSON.stringify(values));
}

export const lightningChatService = new LightningChatService();

function meshEventToMessage(
  event: ChatMeshEvent,
  localPeerId: string | null,
  forceOutgoing = false,
): LightningChatMessage {
  const direction =
    forceOutgoing || event.sender_id === localPeerId ? "outgoing" : "incoming";
  const conversationId = event.group_id
    ? `group:${event.group_id}`
    : event.kind === "private_message" ||
        event.kind === "private_media" ||
        event.kind === "private_voice"
      ? `nearby:mesh:${event.sender_id}`
      : "channel:global";
  const mimeType = event.mime_type ?? "application/octet-stream";
  const media = event.data_base64
    ? {
        kind: (mimeType.startsWith("image/")
          ? "image"
          : mimeType.startsWith("audio/") || event.kind === "voice"
            ? "audio"
            : "file") as "image" | "audio" | "file",
        ...(event.file_name ? { file_name: event.file_name } : {}),
        ...(event.mime_type ? { mime_type: event.mime_type } : {}),
        data_base64: event.data_base64,
      }
    : undefined;
  return {
    id: event.id,
    conversation_id: conversationId,
    author_id: event.sender_id,
    author_name: event.sender_name,
    content:
      event.content ??
      (event.kind === "voice"
        ? "Voice note"
        : event.file_name
          ? `Shared ${event.file_name}`
          : "Shared media"),
    created_at: Math.floor(event.timestamp_ms / 1_000),
    direction,
    delivery: direction === "outgoing" ? "sent" : "delivered",
    transport: "ble_mesh",
    ...(media ? { media } : {}),
  };
}

async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...buffer.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
