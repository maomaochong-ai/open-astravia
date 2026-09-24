import { describe, expect, it } from "vitest";
import {
	decodePublicKey,
	deriveSessionKeys,
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	openFrame,
	RemoteProtocolError,
	sealFrame,
	toBase64Url,
	verificationCode,
} from "../src/index.js";

function handshake() {
	const mobile = { identity: generateIdentityKeyPair(), ephemeral: generateIdentityKeyPair() };
	const desktop = { identity: generateIdentityKeyPair(), ephemeral: generateIdentityKeyPair() };
	const mobileKeys = deriveSessionKeys({
		role: "mobile",
		identity: mobile.identity,
		ephemeral: mobile.ephemeral,
		peerIdentityKey: desktop.identity.publicKey,
		peerEphemeralKey: desktop.ephemeral.publicKey,
	});
	const desktopKeys = deriveSessionKeys({
		role: "desktop",
		identity: desktop.identity,
		ephemeral: desktop.ephemeral,
		peerIdentityKey: mobile.identity.publicKey,
		peerEphemeralKey: mobile.ephemeral.publicKey,
	});
	return { mobile, desktop, mobileKeys, desktopKeys };
}

describe("remote crypto", () => {
	it("derives matching directional keys on both ends", () => {
		const { mobileKeys, desktopKeys } = handshake();
		expect(toBase64Url(mobileKeys.sendKey)).toBe(toBase64Url(desktopKeys.receiveKey));
		expect(toBase64Url(mobileKeys.receiveKey)).toBe(toBase64Url(desktopKeys.sendKey));
		expect(toBase64Url(mobileKeys.sendKey)).not.toBe(toBase64Url(mobileKeys.receiveKey));
	});

	it("binds the session to both static identities", () => {
		const { mobile, desktop, desktopKeys } = handshake();
		const impostor = generateIdentityKeyPair();
		const withImpostorIdentity = deriveSessionKeys({
			role: "mobile",
			identity: impostor,
			ephemeral: mobile.ephemeral,
			peerIdentityKey: desktop.identity.publicKey,
			peerEphemeralKey: desktop.ephemeral.publicKey,
		});
		expect(toBase64Url(withImpostorIdentity.sendKey)).not.toBe(toBase64Url(desktopKeys.receiveKey));
	});

	it("seals and opens a session frame, rejecting tampering and wrong keys", () => {
		const { mobileKeys, desktopKeys } = handshake();
		const frame = { type: "request", requestId: "r1", method: "session.list" } as const;
		const sealed = sealFrame(mobileKeys.sendKey, frame, "aad");
		expect(sealed.type).toBe("sealed");
		expect(openFrame(desktopKeys.receiveKey, sealed, "aad")).toEqual(frame);
		expect(() => openFrame(desktopKeys.receiveKey, sealed, "other")).toThrow(RemoteProtocolError);
		expect(() => openFrame(desktopKeys.sendKey, sealed, "aad")).toThrow(RemoteProtocolError);
		const tampered = { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}AA` };
		expect(() => openFrame(desktopKeys.receiveKey, tampered, "aad")).toThrow(RemoteProtocolError);
	});

	it("never reuses a nonce across frames", () => {
		const { mobileKeys } = handshake();
		const frame = { type: "ack", sequence: 1 } as const;
		const nonces = new Set(Array.from({ length: 50 }, () => sealFrame(mobileKeys.sendKey, frame, "aad").nonce));
		expect(nonces.size).toBe(50);
	});

	it("refuses to open a handshake frame smuggled inside an envelope", () => {
		const { mobileKeys, desktopKeys } = handshake();
		const smuggled = sealFrame(
			mobileKeys.sendKey,
			{ type: "peer_status", online: true } as unknown as { type: "ack"; sequence: number },
			"aad",
		);
		expect(() => openFrame(desktopKeys.receiveKey, smuggled, "aad")).toThrow(RemoteProtocolError);
	});

	it("computes the same six-digit verification code regardless of argument order", () => {
		const a = generateIdentityKeyPair().publicKey;
		const b = generateIdentityKeyPair().publicKey;
		const code = verificationCode(a, b);
		expect(code).toMatch(/^\d{6}$/);
		expect(verificationCode(b, a)).toBe(code);
		expect(verificationCode(a, generateIdentityKeyPair().publicKey)).not.toBe(code);
	});

	it("round-trips base64url and rebuilds a key pair from its secret", () => {
		const pair = generateIdentityKeyPair();
		expect(fromBase64Url(toBase64Url(pair.secretKey))).toEqual(pair.secretKey);
		expect(identityKeyPairFromSecret(pair.secretKey).publicKey).toEqual(pair.publicKey);
		expect(decodePublicKey(toBase64Url(pair.publicKey))).toEqual(pair.publicKey);
		expect(() => decodePublicKey("AAAA")).toThrow(RemoteProtocolError);
	});
});
