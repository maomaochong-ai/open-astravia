/**
 * Prints the crypto vectors pinned in VettaKit/Tests/VettaKitTests/ProtocolTests.swift,
 * computed by the TypeScript package the desktop uses.
 *
 *   bun apps/mobile/client-apple/scripts/crypto-vectors.ts
 */
import { identityKeyPairFromSecret, deriveSessionKeys, sealFrame, verificationCode, toBase64Url, sha256Hex } from "../../../../packages/remote-control/src/index.ts";
const bytes = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) & 0xff);
const mobileId = identityKeyPairFromSecret(bytes(1));
const mobileEph = identityKeyPairFromSecret(bytes(2));
const deskId = identityKeyPairFromSecret(bytes(3));
const deskEph = identityKeyPairFromSecret(bytes(4));
const m = deriveSessionKeys({ role: "mobile", identity: mobileId, ephemeral: mobileEph, peerIdentityKey: deskId.publicKey, peerEphemeralKey: deskEph.publicKey });
const d = deriveSessionKeys({ role: "desktop", identity: deskId, ephemeral: deskEph, peerIdentityKey: mobileId.publicKey, peerEphemeralKey: mobileEph.publicKey });
const nonce = Uint8Array.from({ length: 24 }, (_, i) => i + 100);
const frame = { type: "event", eventId: "e-1", sequence: 1, name: "session.message", sessionId: "s1", payload: { kind: "assistant_delta", text: "你好 world" } } as const;
const sealed = sealFrame(d.sendKey, frame, "vetta-remote-v2", { randomBytes: () => nonce });
console.log(JSON.stringify({
  mobileIdentitySecret: toBase64Url(mobileId.secretKey), mobileIdentityPublic: toBase64Url(mobileId.publicKey),
  mobileEphemeralSecret: toBase64Url(mobileEph.secretKey), mobileEphemeralPublic: toBase64Url(mobileEph.publicKey),
  desktopIdentitySecret: toBase64Url(deskId.secretKey), desktopIdentityPublic: toBase64Url(deskId.publicKey),
  desktopEphemeralSecret: toBase64Url(deskEph.secretKey), desktopEphemeralPublic: toBase64Url(deskEph.publicKey),
  mobileSend: toBase64Url(m.sendKey), mobileReceive: toBase64Url(m.receiveKey),
  desktopSend: toBase64Url(d.sendKey),
  sealedNonce: sealed.nonce, sealedCiphertext: sealed.ciphertext, plaintext: JSON.stringify(frame),
  code: verificationCode(mobileId.publicKey, deskId.publicKey),
  sha: sha256Hex("secret-1234567890abcdef"),
}, null, 2));
