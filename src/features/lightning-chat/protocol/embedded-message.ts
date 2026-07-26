import {
  LIGHTNING_CHAT_DEFAULT_TTL,
  LIGHTNING_CHAT_NOISE_ENCRYPTED,
  LIGHTNING_CHAT_PACKET_VERSION,
  decodeLightningChatPacket,
  encodeLightningChatPacket,
} from "./lightning-chat-packet";

const PRIVATE_MESSAGE = 0x01;
const READ_RECEIPT = 0x02;
const DELIVERED = 0x03;
const EMBEDDED_PREFIX = String.fromCharCode(
  98,
  105,
  116,
  99,
  104,
  97,
  116,
  49,
  58,
);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface EmbeddedPrivateMessage {
  kind: "message";
  messageId: string;
  content: string;
  senderId: string;
  recipientId: string | null;
  timestamp: number;
}

export interface EmbeddedAcknowledgement {
  kind: "delivered" | "read";
  messageId: string;
  senderId: string;
  recipientId: string | null;
  timestamp: number;
}

export type EmbeddedLightningChatPayload =
  EmbeddedPrivateMessage | EmbeddedAcknowledgement;

export function encodeEmbeddedPrivateMessage(input: {
  content: string;
  messageId: string;
  senderId: string;
  recipientId?: string;
  timestamp?: number;
}): string {
  const messageId = encoder.encode(input.messageId);
  const content = encoder.encode(input.content);
  if (messageId.length > 255 || content.length > 255) {
    throw new Error(
      "Lightning Chat private messages are limited to 255 UTF-8 bytes.",
    );
  }
  const tlv = new Uint8Array(1 + 2 + messageId.length + 2 + content.length);
  let offset = 0;
  tlv[offset++] = PRIVATE_MESSAGE;
  tlv[offset++] = 0x00;
  tlv[offset++] = messageId.length;
  tlv.set(messageId, offset);
  offset += messageId.length;
  tlv[offset++] = 0x01;
  tlv[offset++] = content.length;
  tlv.set(content, offset);

  return encodeEmbeddedPacket(tlv, input);
}

export function encodeEmbeddedAcknowledgement(input: {
  kind: "delivered" | "read";
  messageId: string;
  senderId: string;
  recipientId?: string;
  timestamp?: number;
}): string {
  const messageId = encoder.encode(input.messageId);
  const payload = new Uint8Array(1 + messageId.length);
  payload[0] = input.kind === "read" ? READ_RECEIPT : DELIVERED;
  payload.set(messageId, 1);
  return encodeEmbeddedPacket(payload, input);
}

export function decodeEmbeddedLightningChatPayload(
  content: string,
): EmbeddedLightningChatPayload {
  if (!content.startsWith(EMBEDDED_PREFIX)) {
    throw new Error("Missing private-message payload prefix.");
  }
  const packet = decodeLightningChatPacket(
    decodeBase64Url(content.slice(EMBEDDED_PREFIX.length)),
  );
  if (
    packet.type !== LIGHTNING_CHAT_NOISE_ENCRYPTED ||
    packet.payload.length < 1
  ) {
    throw new Error("Unsupported embedded Lightning Chat packet.");
  }
  const common = {
    senderId: bytesToHex(packet.senderId),
    recipientId: packet.recipientId ? bytesToHex(packet.recipientId) : null,
    timestamp: packet.timestamp,
  };
  const payloadType = packet.payload[0];
  if (payloadType === DELIVERED || payloadType === READ_RECEIPT) {
    return {
      ...common,
      kind: payloadType === READ_RECEIPT ? "read" : "delivered",
      messageId: decoder.decode(packet.payload.subarray(1)),
    };
  }
  if (payloadType !== PRIVATE_MESSAGE) {
    throw new Error(
      `Unsupported Lightning Chat encrypted payload ${payloadType}.`,
    );
  }
  const fields = decodePrivateMessageTlv(packet.payload.subarray(1));
  return { ...common, kind: "message", ...fields };
}

export function peerIdFromNostrPubkey(pubkey: string): string {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error("A 32-byte Nostr public key is required.");
  }
  return pubkey.slice(0, 16).toLowerCase();
}

function encodeEmbeddedPacket(
  payload: Uint8Array,
  input: {
    senderId: string;
    recipientId?: string;
    timestamp?: number;
  },
): string {
  const data = encodeLightningChatPacket({
    version: LIGHTNING_CHAT_PACKET_VERSION,
    type: LIGHTNING_CHAT_NOISE_ENCRYPTED,
    ttl: LIGHTNING_CHAT_DEFAULT_TTL,
    timestamp: input.timestamp ?? Date.now(),
    senderId: hexToBytes(input.senderId),
    recipientId: input.recipientId ? hexToBytes(input.recipientId) : null,
    payload,
    signature: null,
  });
  return EMBEDDED_PREFIX + encodeBase64Url(data);
}

function decodePrivateMessageTlv(data: Uint8Array): {
  messageId: string;
  content: string;
} {
  let offset = 0;
  let messageId: string | null = null;
  let content: string | null = null;
  while (offset + 2 <= data.length) {
    const type = readByte(data, offset++);
    const length = readByte(data, offset++);
    if (offset + length > data.length) {
      throw new Error("Lightning Chat private-message TLV is truncated.");
    }
    const value = decoder.decode(data.subarray(offset, offset + length));
    offset += length;
    if (type === 0x00) messageId = value;
    else if (type === 0x01) content = value;
    else throw new Error(`Unknown Lightning Chat private-message TLV ${type}.`);
  }
  if (messageId === null || content === null || offset !== data.length) {
    throw new Error("Lightning Chat private-message TLV is incomplete.");
  }
  return { messageId, content };
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal Lightning Chat peer ID.");
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function readByte(data: Uint8Array, offset: number): number {
  const value = data.at(offset);
  if (value === undefined) {
    throw new Error("Lightning Chat private-message TLV is truncated.");
  }
  return value;
}
