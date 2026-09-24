import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils";
import { decodeSessionFrame, RemoteProtocolError } from "./protocol.js";
import type { RemoteIdentityKeyPair, RemoteRole, RemoteSealed, RemoteSessionFrame } from "./types.js";

/**
 * End-to-end encryption for the remote protocol.
 *
 * Both endpoints hold a long-term X25519 identity key and mint a fresh
 * ephemeral key per connection. The session secret mixes three Diffie-Hellman
 * results (ephemeral/ephemeral, own static/peer ephemeral, own ephemeral/peer
 * static) so a relay that only sees public keys cannot derive it, and a stolen
 * identity key alone does not decrypt past sessions. Directional keys keep the
 * two halves of the conversation from ever sharing a (key, nonce) pair.
 */

const NONCE_LENGTH = 24;
const KEY_LENGTH = 32;
const HKDF_INFO_PREFIX = "vetta-remote-v2";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type RemoteRandomBytes = (length: number) => Uint8Array;

export const defaultRandomBytes: RemoteRandomBytes = (length) => nobleRandomBytes(length);

export function generateIdentityKeyPair(randomBytes: RemoteRandomBytes = defaultRandomBytes): RemoteIdentityKeyPair {
	const secretKey = randomBytes(KEY_LENGTH);
	return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function identityKeyPairFromSecret(secretKey: Uint8Array): RemoteIdentityKeyPair {
	if (secretKey.length !== KEY_LENGTH) throw new RemoteProtocolError("identity secret must be 32 bytes");
	return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export interface RemoteSessionKeys {
	readonly sendKey: Uint8Array;
	readonly receiveKey: Uint8Array;
}

export interface DeriveSessionKeysInput {
	readonly role: Exclude<RemoteRole, "relay">;
	readonly identity: RemoteIdentityKeyPair;
	readonly ephemeral: RemoteIdentityKeyPair;
	readonly peerIdentityKey: Uint8Array;
	readonly peerEphemeralKey: Uint8Array;
}

export function deriveSessionKeys(input: DeriveSessionKeysInput): RemoteSessionKeys {
	const ephemeralShared = x25519.getSharedSecret(input.ephemeral.secretKey, input.peerEphemeralKey);
	const staticToPeerEphemeral = x25519.getSharedSecret(input.identity.secretKey, input.peerEphemeralKey);
	const ephemeralToPeerStatic = x25519.getSharedSecret(input.ephemeral.secretKey, input.peerIdentityKey);
	// Order the static/ephemeral mixes by role so both sides compute the same
	// input regardless of which key belongs to whom.
	const mobileFirst = input.role === "mobile";
	const ikm = concat(
		ephemeralShared,
		mobileFirst ? staticToPeerEphemeral : ephemeralToPeerStatic,
		mobileFirst ? ephemeralToPeerStatic : staticToPeerEphemeral,
	);
	const salt = concat(
		...(mobileFirst
			? [input.identity.publicKey, input.peerIdentityKey, input.ephemeral.publicKey, input.peerEphemeralKey]
			: [input.peerIdentityKey, input.identity.publicKey, input.peerEphemeralKey, input.ephemeral.publicKey]),
	);
	const material = hkdf(sha256, ikm, salt, textEncoder.encode(`${HKDF_INFO_PREFIX}/session`), KEY_LENGTH * 2);
	const mobileToDesktop = material.slice(0, KEY_LENGTH);
	const desktopToMobile = material.slice(KEY_LENGTH);
	return mobileFirst
		? { sendKey: mobileToDesktop, receiveKey: desktopToMobile }
		: { sendKey: desktopToMobile, receiveKey: mobileToDesktop };
}

export interface SealOptions {
	readonly randomBytes?: RemoteRandomBytes;
}

export function sealFrame(
	key: Uint8Array,
	frame: RemoteSessionFrame,
	associatedData: string,
	options: SealOptions = {},
): RemoteSealed {
	const nonce = (options.randomBytes ?? defaultRandomBytes)(NONCE_LENGTH);
	const cipher = xchacha20poly1305(key, nonce, textEncoder.encode(associatedData));
	const ciphertext = cipher.encrypt(textEncoder.encode(JSON.stringify(frame)));
	return { type: "sealed", nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };
}

export function openFrame(key: Uint8Array, sealed: RemoteSealed, associatedData: string): RemoteSessionFrame {
	let plaintext: Uint8Array;
	try {
		const cipher = xchacha20poly1305(key, fromBase64Url(sealed.nonce), textEncoder.encode(associatedData));
		plaintext = cipher.decrypt(fromBase64Url(sealed.ciphertext));
	} catch {
		throw new RemoteProtocolError("sealed frame failed authentication");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(textDecoder.decode(plaintext));
	} catch {
		throw new RemoteProtocolError("sealed frame is not valid JSON");
	}
	return decodeSessionFrame(parsed);
}

/**
 * Six digits derived from both identity keys. Displayed on both ends of a
 * manual pairing so the person can confirm no third party sits in between.
 */
export function verificationCode(identityKeyA: Uint8Array, identityKeyB: Uint8Array): string {
	const [first, second] =
		compareBytes(identityKeyA, identityKeyB) <= 0 ? [identityKeyA, identityKeyB] : [identityKeyB, identityKeyA];
	const digest = hkdf(sha256, concat(first, second), undefined, textEncoder.encode(`${HKDF_INFO_PREFIX}/sas`), 4);
	const value = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
	return String(value % 1_000_000).padStart(6, "0");
}

export function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
	const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new RemoteProtocolError("value is not valid base64url");
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function decodePublicKey(text: string, field = "public key"): Uint8Array {
	const bytes = fromBase64Url(text);
	if (bytes.length !== KEY_LENGTH) throw new RemoteProtocolError(`${field} must be 32 bytes`);
	return bytes;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
	return diff === 0;
}

export function sha256Hex(text: string): string {
	return Array.from(sha256(textEncoder.encode(text)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32, randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	return toBase64Url(randomBytes(bytes));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const diff = a[index]! - b[index]!;
		if (diff !== 0) return diff;
	}
	return a.length - b.length;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}
