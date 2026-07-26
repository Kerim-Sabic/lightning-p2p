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
  media?: {
    kind: "image" | "audio" | "file";
    file_name?: string;
    mime_type?: string;
    data_base64: string;
  };
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
  mesh_id?: string;
  fingerprint?: string;
  noise_ready?: boolean;
}

export interface LightningChatGroup {
  id: string;
  name: string;
  epoch: number;
  members: string[];
}

export interface LightningChatSnapshot {
  status: LightningChatStatus;
  identity: LightningChatIdentity | null;
  active_channel: LightningChatChannel;
  relays: string[];
  connected_relays: number;
  messages: LightningChatMessage[];
  peers: LightningChatPeer[];
  groups: LightningChatGroup[];
  mesh_peer_id: string | null;
  mesh_links: number;
  error: string | null;
}

export const DEFAULT_LIGHTNING_CHAT_CHANNEL: LightningChatChannel = {
  id: "global",
  label: "Nearby mesh",
  geohash: "",
  scope: "region",
};

export const WEB_LIGHTNING_CHAT_CHANNEL: LightningChatChannel = {
  id: "web-lounge",
  label: "Web lounge",
  geohash: "lightning-web",
  scope: "region",
};
