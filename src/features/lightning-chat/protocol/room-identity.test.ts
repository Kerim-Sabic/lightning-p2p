import { generateSecretKey, getPublicKey } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { deriveRoomSecretKey } from "./room-identity";

describe("Lightning Chat room identities", () => {
  it("is stable for one room so identity survives reloads", () => {
    const root = generateSecretKey();
    expect(deriveRoomSecretKey(root, "u2edk")).toEqual(
      deriveRoomSecretKey(root, " U2EDK "),
    );
  });

  it("cannot be linked across rooms or to the root identity", () => {
    const root = generateSecretKey();
    const rootPubkey = getPublicKey(root);
    const rooms = ["u2edk", "u2edm", "u2", "9q8yy"].map((geohash) =>
      getPublicKey(deriveRoomSecretKey(root, geohash)),
    );
    expect(new Set([rootPubkey, ...rooms]).size).toBe(rooms.length + 1);
  });

  it("differs between devices in the same room", () => {
    expect(
      getPublicKey(deriveRoomSecretKey(generateSecretKey(), "u2edk")),
    ).not.toBe(getPublicKey(deriveRoomSecretKey(generateSecretKey(), "u2edk")));
  });

  it("refuses to derive a key without a room", () => {
    expect(() => deriveRoomSecretKey(generateSecretKey(), "  ")).toThrow();
  });
});
