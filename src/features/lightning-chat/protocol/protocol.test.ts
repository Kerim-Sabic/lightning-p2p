import { generateSecretKey, getPublicKey, type Event } from "nostr-tools";
import { describe, expect, it } from "vitest";
import legacyEnvelope from "./fixtures/legacy-private-envelope-733098bb.json";
import {
  decodeEmbeddedLightningChatPayload,
  encodeEmbeddedAcknowledgement,
  encodeEmbeddedPrivateMessage,
  peerIdFromNostrPubkey,
} from "./embedded-message";
import {
  createLightningChatPrivateEnvelope,
  decryptLightningChatPrivateEnvelope,
  decryptPrivateLayer,
  encryptPrivateLayer,
} from "./private-envelope";

describe("Lightning Chat wire compatibility", () => {
  it("round-trips the padded private-message packet", () => {
    const encoded = encodeEmbeddedPrivateMessage({
      content: "meet at the bridge",
      messageId: "018f6a74-e8f4-7fe2-a2e6-3b26e5800001",
      senderId: "0011223344556677",
      recipientId: "8899aabbccddeeff",
      timestamp: 1_720_000_000_123,
    });

    expect(decodeEmbeddedLightningChatPayload(encoded)).toEqual({
      kind: "message",
      messageId: "018f6a74-e8f4-7fe2-a2e6-3b26e5800001",
      content: "meet at the bridge",
      senderId: "0011223344556677",
      recipientId: "8899aabbccddeeff",
      timestamp: 1_720_000_000_123,
    });
  });

  it("round-trips delivery acknowledgements", () => {
    const encoded = encodeEmbeddedAcknowledgement({
      kind: "read",
      messageId: "message-42",
      senderId: "0011223344556677",
    });

    expect(decodeEmbeddedLightningChatPayload(encoded)).toMatchObject({
      kind: "read",
      messageId: "message-42",
    });
  });

  it("round-trips raw-deflate compression", () => {
    const content = "offline mesh message ".repeat(8).slice(0, 220);
    const encoded = encodeEmbeddedPrivateMessage({
      content,
      messageId: "compressed-message",
      senderId: "0011223344556677",
    });

    expect(decodeEmbeddedLightningChatPayload(encoded)).toMatchObject({
      kind: "message",
      content,
    });
  });

  it("round-trips the v2 encryption layer", () => {
    const alice = generateSecretKey();
    const bob = generateSecretKey();
    const encrypted = encryptPrivateLayer(
      "private",
      getPublicKey(bob),
      alice,
      new Uint8Array(24).fill(7),
    );

    expect(decryptPrivateLayer(encrypted, getPublicKey(alice), bob)).toBe(
      "private",
    );
  });

  it("authenticates and decrypts the complete gift-wrap envelope", () => {
    const sender = generateSecretKey();
    const recipient = generateSecretKey();
    const giftWrap = createLightningChatPrivateEnvelope({
      content: "private-payload",
      recipientPubkey: getPublicKey(recipient),
      senderSecretKey: sender,
      now: 1_720_000_000,
    });

    expect(decryptLightningChatPrivateEnvelope(giftWrap, recipient)).toEqual({
      content: "private-payload",
      senderPubkey: getPublicKey(sender),
      timestamp: 1_720_000_000,
    });
  });

  it("decrypts the frozen cross-client release fixture", () => {
    const recipientKey = bytesFromHex(
      "8355a5c110cdfef2e644f4ad5d51c39f253b2c2c80ebb6856379fb16531dc1fa",
    );

    expect(
      decryptLightningChatPrivateEnvelope(
        legacyEnvelope as Event,
        recipientKey,
      ),
    ).toMatchObject({
      content: "legacy fixture from 733098bb",
      senderPubkey:
        "2e3d79df7047204f02b726c574e256f8de1dd80510f7dcb8b0d12df13acb87e6",
    });
  });

  it("derives the deployed Nostr peer-id shape", () => {
    expect(peerIdFromNostrPubkey("ab".repeat(32))).toBe("ab".repeat(8));
  });
});

function bytesFromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
