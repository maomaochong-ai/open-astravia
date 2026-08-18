import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

/**
 * Sensitive IM credentials. Persisted under
 *   ~/.vetta/desktop-app/im-credentials.json
 *
 * Stored as plain JSON with chmod 0600. We deliberately do NOT encrypt
 * via Electron safeStorage: the user explicitly requested "save it,
 * don't bother encrypting", and the encrypted-then-placeholder UX broke
 * the test-connection / re-save flow (placeholder was being treated as
 * an empty password).
 *
 * If you later want encryption back, the easiest path is to keep this
 * shape and add a versioned magic prefix similar to the original
 * implementation.
 */

export interface ImCredentials {
	feishu?: {
		appSecret: string;
		verificationToken?: string;
		encryptKey?: string;
	};
}

const DEFAULT_DIR = join(getVettaHomePath(), "desktop-app");
const DEFAULT_FILE = join(DEFAULT_DIR, "im-credentials.json");

function ensureDir(): void {
	if (!existsSync(DEFAULT_DIR)) {
		mkdirSync(DEFAULT_DIR, { recursive: true });
	}
}

function writeStrict(path: string, data: string): void {
	writeFileSync(path, data, "utf-8");
	try {
		chmodSync(path, 0o600);
	} catch {
		// chmod can fail on certain filesystems (FAT/NTFS) — best effort.
	}
}

export interface CredentialStoreInfo {
	encryptionAvailable: false;
	path: string;
}

export function getCredentialStoreInfo(filePath = DEFAULT_FILE): CredentialStoreInfo {
	return {
		encryptionAvailable: false,
		path: filePath,
	};
}

export function loadCredentials(filePath = DEFAULT_FILE): ImCredentials {
	if (!existsSync(filePath)) return {};
	try {
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as ImCredentials;
	} catch {
		return {};
	}
}

export function saveCredentials(creds: ImCredentials, filePath = DEFAULT_FILE): { mode: "plaintext" } {
	ensureDir();
	writeStrict(filePath, JSON.stringify(creds, null, 2));
	return { mode: "plaintext" };
}

export function defaultCredentialsPath(): string {
	return DEFAULT_FILE;
}
export function defaultCredentialsDir(): string {
	return DEFAULT_DIR;
}
export { dirname };
