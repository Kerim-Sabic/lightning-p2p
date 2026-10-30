import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ROOM_KEY_LABEL = "lightning-chat/room-identity/v1/";
const MAX_DERIVATION_ATTEMPTS = 16;

/**
 * Derives the signing key used inside one location room.
 *
 * Every room gets its own unlinkable keypair: a relay or another participant
 * cannot match your posts or 30-second presence beacons in one geohash to
 * those in another, or to the long-lived identity you share for direct
 * messages. The key is a deterministic HMAC of the local root secret, so it
 * survives reloads without extra storage and disappears with a panic wipe.
 */
export function deriveRoomSecretKey(
  rootSecretKey: Uint8Array,
  geohash: string,
): Uint8Array {
  const room = geohash.trim().toLowerCase();
  if (!room) throw new Error("A room identity needs a geohash.");
  const encoder = new TextEncoder();
  for (let attempt = 0; attempt < MAX_DERIVATION_ATTEMPTS; attempt += 1) {
    const candidate = hmac(
      sha256,
      rootSecretKey,
      encoder.encode(`${ROOM_KEY_LABEL}${room}/${attempt}`),
    );
    // Rejection sampling: ~2^-128 chance a digest is not a valid scalar.
    if (secp256k1.utils.isValidSecretKey(candidate)) return candidate;
  }
  throw new Error("Could not derive a room identity.");
}
