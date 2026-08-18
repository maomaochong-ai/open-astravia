import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { WebhookEndpointSecret } from "./types.js";

/**
 * Sensitive webhook credentials. Persisted under
 *   ~/.vetta/desktop-app/webhook-credentials.json
 *
 * Stored as plain JSON with chmod 0600, mirroring the IM credential store.
 * The renderer never reads this file directly — it only sees masked URLs
 * via the public endpoint snapshot.
 */

export type WebhookCredentialsMap = Record<string, WebhookEndpointSecret>;

const DEFAULT_DIR = join(getVettaHomePath(), "desktop-app");
const DEFAULT_FILE = join(DEFAULT_DIR, "webhook-credentials.json");

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function writeStrict(path: string, data: string): void {
	ensureDir(dirname(path));
	writeFileSync(path, data, "utf-8");
	try {
		chmodSync(path, 0o600);
	} catch {
		// chmod can fail on certain filesystems (FAT/NTFS) — best effort.
	}
}

export function defaultWebhookCredentialsPath(): string {
	return DEFAULT_FILE;
}

export function loadWebhookCredentials(filePath = DEFAULT_FILE): WebhookCredentialsMap {
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const out: WebhookCredentialsMap = {};
		for (const [id, raw] of Object.entries(parsed)) {
			if (!raw || typeof raw !== "object") continue;
			const url = (raw as { webhookUrl?: unknown }).webhookUrl;
			if (typeof url !== "string" || !url) continue;
			const signSecretValue = (raw as { signSecret?: unknown }).signSecret;
			out[id] = {
				webhookUrl: url,
				signSecret: typeof signSecretValue === "string" && signSecretValue ? signSecretValue : undefined,
			};
		}
		return out;
	} catch {
		return {};
	}
}

export function saveWebhookCredentials(map: WebhookCredentialsMap, filePath = DEFAULT_FILE): void {
	writeStrict(filePath, JSON.stringify(map, null, 2));
}

/**
 * Best-effort URL mask: keep protocol + host, drop the path/query, suffix
 * with the last 4 chars of the original URL so the user can confirm which
 * endpoint a row represents without leaking the token.
 */
export function maskWebhookUrl(url: string): string {
	try {
		const u = new URL(url);
		const tail = url.slice(-4);
		return `${u.protocol}//${u.host}/…${tail}`;
	} catch {
		const tail = url.slice(-4);
		return `…${tail}`;
	}
}
