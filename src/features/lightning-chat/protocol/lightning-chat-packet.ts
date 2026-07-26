import { deflateRaw, inflate, inflateRaw } from "pako";

export const LIGHTNING_CHAT_PACKET_VERSION = 1;
export const LIGHTNING_CHAT_DEFAULT_TTL = 7;
export const LIGHTNING_CHAT_NOISE_ENCRYPTED = 0x11;

const V1_HEADER_SIZE = 14;
const PEER_ID_SIZE = 8;
const SIGNATURE_SIZE = 64;
const FLAG_RECIPIENT = 0x01;
const FLAG_SIGNATURE = 0x02;
const FLAG_COMPRESSED = 0x04;
const PADDING_BLOCKS = [256, 512, 1_024, 2_048] as const;

export interface LightningChatPacket {
  version: number;
  type: number;
  ttl: number;
  timestamp: number;
  senderId: Uint8Array;
  recipientId: Uint8Array | null;
  payload: Uint8Array;
  signature: Uint8Array | null;
}

export function encodeLightningChatPacket(
  packet: LightningChatPacket,
  padding = true,
): Uint8Array {
  if (packet.version !== LIGHTNING_CHAT_PACKET_VERSION) {
    throw new Error("Only Lightning Chat packet version 1 is supported.");
  }
  const compressed = compressPayload(packet.payload);
  const wirePayload = compressed?.payload ?? packet.payload;
  const payloadPrefix = compressed ? 2 : 0;
  const payloadLength = wirePayload.length + payloadPrefix;
  if (payloadLength > 0xffff) {
    throw new Error("Lightning Chat v1 payload exceeds 65,535 bytes.");
  }

  const hasRecipient = packet.recipientId !== null;
  const hasSignature = packet.signature !== null;
  const size =
    V1_HEADER_SIZE +
    PEER_ID_SIZE +
    (hasRecipient ? PEER_ID_SIZE : 0) +
    payloadLength +
    (hasSignature ? SIGNATURE_SIZE : 0);
  const encoded = new Uint8Array(size);
  const view = new DataView(encoded.buffer);
  let offset = 0;

  encoded[offset++] = packet.version;
  encoded[offset++] = packet.type;
  encoded[offset++] = packet.ttl;
  view.setBigUint64(offset, BigInt(Math.trunc(packet.timestamp)), false);
  offset += 8;
  encoded[offset++] =
    (hasRecipient ? FLAG_RECIPIENT : 0) |
    (hasSignature ? FLAG_SIGNATURE : 0) |
    (compressed ? FLAG_COMPRESSED : 0);
  view.setUint16(offset, payloadLength, false);
  offset += 2;
  encoded.set(normalizePeerId(packet.senderId), offset);
  offset += PEER_ID_SIZE;

  if (packet.recipientId) {
    encoded.set(normalizePeerId(packet.recipientId), offset);
    offset += PEER_ID_SIZE;
  }
  if (compressed) {
    view.setUint16(offset, compressed.originalSize, false);
    offset += 2;
  }
  encoded.set(wirePayload, offset);
  offset += wirePayload.length;
  if (packet.signature) {
    encoded.set(normalizeBytes(packet.signature, SIGNATURE_SIZE), offset);
  }

  return padding ? padLightningChatPacket(encoded) : encoded;
}

export function decodeLightningChatPacket(
  data: Uint8Array,
): LightningChatPacket {
  if (data.length < V1_HEADER_SIZE + PEER_ID_SIZE) {
    throw new Error("Lightning Chat packet is truncated.");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const version = readByte(data, offset++);
  if (version !== LIGHTNING_CHAT_PACKET_VERSION) {
    throw new Error(`Unsupported Lightning Chat packet version ${version}.`);
  }
  const type = readByte(data, offset++);
  const ttl = readByte(data, offset++);
  const timestamp = Number(view.getBigUint64(offset, false));
  offset += 8;
  const flags = readByte(data, offset++);
  const payloadLength = view.getUint16(offset, false);
  offset += 2;
  const senderId = readBytes(data, offset, PEER_ID_SIZE);
  offset += PEER_ID_SIZE;
  const recipientId =
    (flags & FLAG_RECIPIENT) !== 0
      ? readBytes(data, offset, PEER_ID_SIZE)
      : null;
  if (recipientId) offset += PEER_ID_SIZE;
  const wirePayload = readBytes(data, offset, payloadLength);
  offset += payloadLength;
  const payload =
    (flags & FLAG_COMPRESSED) !== 0
      ? decompressPayload(wirePayload)
      : wirePayload;
  const signature =
    (flags & FLAG_SIGNATURE) !== 0
      ? readBytes(data, offset, SIGNATURE_SIZE)
      : null;

  return {
    version,
    type,
    ttl,
    timestamp,
    senderId,
    recipientId,
    payload,
    signature,
  };
}

function padLightningChatPacket(data: Uint8Array): Uint8Array {
  const target = PADDING_BLOCKS.find((block) => data.length + 16 <= block);
  if (!target) return data;
  const paddingLength = target - data.length;
  if (paddingLength < 1 || paddingLength > 255) return data;
  const padded = new Uint8Array(target);
  padded.set(data);
  padded.fill(paddingLength, data.length);
  return padded;
}

function normalizePeerId(value: Uint8Array): Uint8Array {
  return normalizeBytes(value, PEER_ID_SIZE);
}

function normalizeBytes(value: Uint8Array, size: number): Uint8Array {
  const normalized = new Uint8Array(size);
  normalized.set(value.subarray(0, size));
  return normalized;
}

function readBytes(
  data: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  if (offset + length > data.length) {
    throw new Error("Lightning Chat packet field is truncated.");
  }
  return data.slice(offset, offset + length);
}

function readByte(data: Uint8Array, offset: number): number {
  const value = data.at(offset);
  if (value === undefined) {
    throw new Error("Lightning Chat packet is truncated.");
  }
  return value;
}

function compressPayload(
  payload: Uint8Array,
): { payload: Uint8Array; originalSize: number } | null {
  if (payload.length < 100 || payload.length > 0xffff) return null;
  const sampleSize = Math.min(payload.length, 256);
  const uniqueRatio = new Set(payload).size / sampleSize;
  if (uniqueRatio >= 0.9) return null;
  const compressed = deflateRaw(payload);
  return compressed.length < payload.length
    ? { payload: compressed, originalSize: payload.length }
    : null;
}

function decompressPayload(wirePayload: Uint8Array): Uint8Array {
  if (wirePayload.length < 3) {
    throw new Error("Compressed Lightning Chat payload is truncated.");
  }
  const view = new DataView(
    wirePayload.buffer,
    wirePayload.byteOffset,
    wirePayload.byteLength,
  );
  const originalSize = view.getUint16(0, false);
  const compressed = wirePayload.subarray(2);
  if (compressed.length === 0 || originalSize / compressed.length > 50_000) {
    throw new Error("Compressed Lightning Chat payload failed safety limits.");
  }
  let decompressed: Uint8Array;
  try {
    decompressed = inflateRaw(compressed);
  } catch {
    decompressed = inflate(compressed);
  }
  if (decompressed.length !== originalSize) {
    throw new Error(
      "Compressed Lightning Chat payload has an invalid decoded size.",
    );
  }
  return decompressed;
}
