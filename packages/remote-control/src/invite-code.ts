import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import { defaultRandomBytes, fromBase64Url, type RemoteRandomBytes, toBase64Url } from "./crypto.js";
import { RemoteProtocolError } from "./protocol.js";

/**
 * Pairing without a camera: the desktop seals its pairing URI under a short
 * connection code and a password, and leaves the sealed copy in a mailbox on the
 * relay for a few minutes. The phone types both in, fetches the mailbox named by
 * the code and opens it with the password.
 *
 * The relay only learns a hash of the code, never the code, the password or the
 * URI. Guessing codes has to go through the relay (40 bits, a handful of reads per
 * mailbox); the password (20 bits) only guards the copy the relay hands out, so
 * the key is stretched with PBKDF2 and the mailbox expires with the invite.
 */

export const INVITE_CODE_LENGTH = 8;
export const INVITE_PASSWORD_LENGTH = 6;
export const INVITE_KDF_ITERATIONS = 200_000;
export const INVITE_ASSOCIATED_DATA = "vetta-invite-v1";
/** Longest sealed envelope the relay keeps, as serialized JSON. */
export const MAX_INVITE_ENVELOPE_CHARS = 8_192;

/** Crockford base32: no I, L, O or U, so a code read aloud or retyped survives. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BOX_ID_PREFIX = "vetta-invite-box-v1:";
const KEY_SALT_PREFIX = "vetta-invite-key-v1:";
const NONCE_LENGTH = 24;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface RemoteInviteEnvelope {
	readonly v: 1;
	readonly nonce: string;
	readonly ciphertext: string;
}

/** Eight characters, 40 bits, drawn without bias. */
export function generateInviteCode(randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	return Array.from(randomBytes(INVITE_CODE_LENGTH), (byte) => CODE_ALPHABET[byte & 31]).join("");
}

/** Six digits; rejection sampling keeps every value equally likely. */
export function generateInvitePassword(randomBytes: RemoteRandomBytes = defaultRandomBytes): string {
	let digits = "";
	while (digits.length < INVITE_PASSWORD_LENGTH) {
		for (const byte of randomBytes(INVITE_PASSWORD_LENGTH)) {
			if (byte < 250 && digits.length < INVITE_PASSWORD_LENGTH) digits += String(byte % 10);
		}
	}
	return digits;
}

/** "K7Q29MXD" → "K7Q2-9MXD", the way both ends show it. */
export function formatInviteCode(code: string): string {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What was typed, as the code it names: case, spaces and dashes do not matter, and
 * the letters Crockford leaves out read as the digits they look like. Undefined
 * when it cannot be a code.
 */
export function normalizeInviteCode(input: string): string | undefined {
	const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
	if (code.length !== INVITE_CODE_LENGTH) return undefined;
	for (const char of code) if (!CODE_ALPHABET.includes(char)) return undefined;
	return code;
}

export function isValidInvitePassword(password: string): boolean {
	return new RegExp(`^\\d{${INVITE_PASSWORD_LENGTH}}$`).test(password);
}

/**
 * The pairing QR code's text when the invite has a connection code: the code and the
 * password instead of the whole pairing URI, so the QR code needs a quarter of the
 * modules. Upper case keeps it in the QR alphanumeric mode. The relay is named only
 * when it is not the one the phones use by default.
 */
export interface InviteQr {
	readonly code: string;
	readonly password: string;
	readonly relayBaseUrl?: string;
}

const INVITE_QR_PREFIX = "VETTA://PAIR/";

export function buildInviteQr(invite: InviteQr): string {
	const text = `${INVITE_QR_PREFIX}${invite.code}/${invite.password}`;
	return invite.relayBaseUrl ? `${text}?relay=${encodeURIComponent(invite.relayBaseUrl)}` : text;
}

/** The code, password and relay in a scanned invite QR code, or undefined for any other text. */
export function parseInviteQr(text: string): InviteQr | undefined {
	const trimmed = text.trim();
	if (trimmed.slice(0, INVITE_QR_PREFIX.length).toUpperCase() !== INVITE_QR_PREFIX) return undefined;
	const [path = "", query = ""] = trimmed.slice(INVITE_QR_PREFIX.length).split("?", 2);
	const [rawCode = "", password = "", ...rest] = path.split("/");
	const code = normalizeInviteCode(rawCode);
	if (!code || rest.length > 0 || !isValidInvitePassword(password)) return undefined;
	const relay = new URLSearchParams(query).get("relay") ?? undefined;
	if (relay !== undefined && !/^wss?:\/\/[^\s/]+/i.test(relay)) return undefined;
	return relay ? { code, password, relayBaseUrl: relay } : { code, password };
}

/** The mailbox's name on the relay; the code itself never leaves the two ends. */
export function inviteBoxId(code: string): string {
	return toBase64Url(sha256(textEncoder.encode(`${BOX_ID_PREFIX}${code}`)));
}

export function inviteBoxUrl(relayBaseUrl: string, boxId: string): string {
	return `${relayBaseUrl.replace(/^ws(s?):/, "http$1:")}/v2/invite/${boxId}`;
}

export async function sealInvite(
	inviteUri: string,
	code: string,
	password: string,
	randomBytes: RemoteRandomBytes = defaultRandomBytes,
): Promise<RemoteInviteEnvelope> {
	const key = await inviteKey(code, password);
	const nonce = randomBytes(NONCE_LENGTH);
	const cipher = xchacha20poly1305(key, nonce, textEncoder.encode(INVITE_ASSOCIATED_DATA));
	return { v: 1, nonce: toBase64Url(nonce), ciphertext: toBase64Url(cipher.encrypt(textEncoder.encode(inviteUri))) };
}

/** The pairing URI inside, or a protocol error when the password (or code) is wrong. */
export async function openInvite(envelope: RemoteInviteEnvelope, code: string, password: string): Promise<string> {
	const key = await inviteKey(code, password);
	try {
		const cipher = xchacha20poly1305(key, fromBase64Url(envelope.nonce), textEncoder.encode(INVITE_ASSOCIATED_DATA));
		return textDecoder.decode(cipher.decrypt(fromBase64Url(envelope.ciphertext)));
	} catch {
		throw new RemoteProtocolError("invite failed authentication");
	}
}

/** A well-formed envelope, or undefined. */
export function readInviteEnvelope(value: unknown): RemoteInviteEnvelope | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (record.v !== 1 || typeof record.nonce !== "string" || typeof record.ciphertext !== "string") return undefined;
	if (!/^[A-Za-z0-9_-]{32}$/.test(record.nonce)) return undefined;
	if (!/^[A-Za-z0-9_-]{22,}$/.test(record.ciphertext) || record.ciphertext.length > MAX_INVITE_ENVELOPE_CHARS) {
		return undefined;
	}
	return { v: 1, nonce: record.nonce, ciphertext: record.ciphertext };
}

function inviteKey(code: string, password: string): Promise<Uint8Array> {
	return pbkdf2Async(sha256, textEncoder.encode(password), textEncoder.encode(`${KEY_SALT_PREFIX}${code}`), {
		c: INVITE_KDF_ITERATIONS,
		dkLen: 32,
	});
}
