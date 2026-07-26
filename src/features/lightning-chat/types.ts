export type LightningChatStatus =
  "starting" | "connecting" | "online" | "degraded" | "offline";

export type LightningChatTransport = "nostr" | "iroh" | "ble_mesh";
export type LightningChatDelivery =
  "sending" | "sent" | "delivered" | "read" | "failed";

export interface LightningChatIdentity {
  pubkey: string;
  npub: string;
  nickname: string;
}

export interface LightningChatMessage {
  id: string;
  conversation_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: number;
  direction: "incoming" | "outgoing";
  delivery: LightningChatDelivery;
  transport: LightningChatTransport;
}

export interface LightningChatChannel {
  id: string;
  label: string;
  geohash: string;
  scope: "block" | "neighborhood" | "city" | "province" | "region";
}

export interface LightningChatPeer {
  id: string;
  label: string;
  npub?: string;
  node_id?: string;
  is_favorite: boolean;
  is_blocked: boolean;
  is_nearby: boolean;
}

export interface LightningChatSnapshot {
  status: LightningChatStatus;
  identity: LightningChatIdentity | null;
  active_channel: LightningChatChannel;
  relays: string[];
  connected_relays: number;
  messages: LightningChatMessage[];
  peers: LightningChatPeer[];
  error: string | null;
}

export const DEFAULT_LIGHTNING_CHAT_CHANNEL: LightningChatChannel = {
  id: "global",
  label: "Nearby mesh",
  geohash: "",
  scope: "region",
};
