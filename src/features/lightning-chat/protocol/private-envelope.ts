import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools";

const PRIVATE_ENVELOPE_PREFIX = "v2:";
const PRIVATE_ENVELOPE_INFO = new TextEncoder().encode("nip44-v2");
const EMPTY_SALT = new Uint8Array();
const MAX_CIPHERTEXT_BYTES = 64 * 1_024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

interface UnsignedRumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: 14;
  tags: string[][];
  content: string;
}

export interface DecryptedPrivateEnvelope {
  content: string;
  senderPubkey: string;
  timestamp: number;
}

export function createLightningChatPrivateEnvelope(input: {
  content: string;
  recipientPubkey: string;
  senderSecretKey: Uint8Array;
  now?: number;
}): VerifiedEvent {
  validatePubkey(input.recipientPubkey);
  const senderPubkey = getPublicKey(input.senderSecretKey);
  const now = input.now ?? Math.floor(Date.now() / 1_000);
  const rumor: UnsignedRumor = {
    id: "",
    pubkey: senderPubkey,
    created_at: now,
    kind: 14,
    tags: [],
    content: input.content,
  };
  const seal = finalizeEvent(
    {
      created_at: randomizedTimestamp(now),
      kind: 13,
      tags: [],
      content: encryptPrivateLayer(
        JSON.stringify(rumor),
        input.recipientPubkey,
        input.senderSecretKey,
      ),
    },
    input.senderSecretKey,
  );
  const wrapSecretKey = generateSecretKey();
  return finalizeEvent(
    {
      created_at: randomizedTimestamp(now),
      kind: 1059,
      tags: [["p", input.recipientPubkey]],
      content: encryptPrivateLayer(
        JSON.stringify(seal),
        input.recipientPubkey,
        wrapSecretKey,
      ),
    },
    wrapSecretKey,
  );
}

export function decryptLightningChatPrivateEnvelope(
  giftWrap: Event,
  recipientSecretKey: Uint8Array,
): DecryptedPrivateEnvelope {
  const recipientPubkey = getPublicKey(recipientSecretKey);
  if (
    giftWrap.kind !== 1059 ||
    !sameTags(giftWrap.tags, [["p", recipientPubkey]]) ||
    !verifyEvent(giftWrap)
  ) {
    throw new Error(
      "Lightning Chat gift wrap is malformed or unauthenticated.",
    );
  }
  const seal = parseEvent(
    decryptPrivateLayer(giftWrap.content, giftWrap.pubkey, recipientSecretKey),
  );
  if (seal.kind !== 13 || seal.tags.length !== 0 || !verifyEvent(seal)) {
    throw new Error("Lightning Chat seal is malformed or unauthenticated.");
  }
  const rumor = parseRumor(
    decryptPrivateLayer(seal.content, seal.pubkey, recipientSecretKey),
  );
  const acceptedTags =
    rumor.tags.length === 0 || sameTags(rumor.tags, [["p", recipientPubkey]]);
  if (
    rumor.kind !== 14 ||
    rumor.pubkey !== seal.pubkey ||
    !acceptedTags ||
    "sig" in rumor
  ) {
    throw new Error("Lightning Chat private rumor does not match its sender.");
  }
  return {
    content: rumor.content,
    senderPubkey: seal.pubkey,
    timestamp: rumor.created_at,
  };
}

export function encryptPrivateLayer(
  plaintext: string,
  recipientPubkey: string,
  senderSecretKey: Uint8Array,
  nonce = crypto.getRandomValues(new Uint8Array(24)),
): string {
  const key = derivePrivateEnvelopeKey(
    senderSecretKey,
    compressedPubkey(recipientPubkey, 0x02),
  );
  const sealed = xchacha20poly1305(key, nonce).encrypt(
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(nonce.length + sealed.length);
  combined.set(nonce);
  combined.set(sealed, nonce.length);
  return PRIVATE_ENVELOPE_PREFIX + encodeBase64Url(combined);
}

export function decryptPrivateLayer(
  ciphertext: string,
  senderPubkey: string,
  recipientSecretKey: Uint8Array,
): string {
  if (!ciphertext.startsWith(PRIVATE_ENVELOPE_PREFIX)) {
    throw new Error(
      "Lightning Chat private envelope is missing its v2 prefix.",
    );
  }
  const combined = decodeBase64Url(
    ciphertext.slice(PRIVATE_ENVELOPE_PREFIX.length),
  );
  if (combined.length <= 40 || combined.length > MAX_CIPHERTEXT_BYTES + 40) {
    throw new Error("Lightning Chat private envelope has an invalid size.");
  }
  const nonce = combined.subarray(0, 24);
  const sealed = combined.subarray(24);
  const parities = [0x02, 0x03] as const;
  for (const parity of parities) {
    try {
      const key = derivePrivateEnvelopeKey(
        recipientSecretKey,
        compressedPubkey(senderPubkey, parity),
      );
      return decoder.decode(xchacha20poly1305(key, nonce).decrypt(sealed));
    } catch {
      // The deployed format accepts both y parities for x-only Nostr keys.
    }
  }
  throw new Error("Lightning Chat private envelope could not be decrypted.");
}

function derivePrivateEnvelopeKey(
  secretKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const compressedSharedPoint = secp256k1.getSharedSecret(
    secretKey,
    publicKey,
    true,
  );
  return hkdf(
    sha256,
    compressedSharedPoint,
    EMPTY_SALT,
    PRIVATE_ENVELOPE_INFO,
    32,
  );
}

function compressedPubkey(pubkey: string, parity: 0x02 | 0x03): Uint8Array {
  validatePubkey(pubkey);
  const compressed = new Uint8Array(33);
  compressed[0] = parity;
  compressed.set(hexToBytes(pubkey), 1);
  return compressed;
}

function parseEvent(value: string): Event {
  const parsed: unknown = JSON.parse(value);
  if (!isEvent(parsed)) {
    throw new Error("Invalid Lightning Chat signed event.");
  }
  return parsed;
}

function parseRumor(value: string): UnsignedRumor {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.id !== "string" ||
    typeof parsed.pubkey !== "string" ||
    typeof parsed.created_at !== "number" ||
    parsed.kind !== 14 ||
    !isTags(parsed.tags) ||
    typeof parsed.content !== "string"
  ) {
    throw new Error("Invalid Lightning Chat private rumor.");
  }
  return parsed as unknown as UnsignedRumor;
}

function isEvent(value: unknown): value is Event {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.pubkey === "string" &&
    typeof value.created_at === "number" &&
    typeof value.kind === "number" &&
    isTags(value.tags) &&
    typeof value.content === "string" &&
    typeof value.sig === "string"
  );
}

function isTags(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.length <= 8 &&
        tag.every((item) => typeof item === "string" && item.length <= 1_024),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sameTags(left: string[][], right: string[][]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function randomizedTimestamp(now: number): number {
  return now + Math.floor(Math.random() * 1_801) - 900;
}

function validatePubkey(pubkey: string): void {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error("A 32-byte hexadecimal Nostr public key is required.");
  }
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
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
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export type LightningChatEventTemplate = EventTemplate;
