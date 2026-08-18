import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import { WEBHOOK_KINDS, type WebhookEndpointPublic, type WebhookKind } from "./types.js";

/**
 * Non-secret webhook endpoint metadata. Stored in plaintext under
 *   ~/.vetta/desktop-app/webhook-config.json
 *
 * Sensitive fields (raw webhook URL, sign secret) live in credential-store.ts;
 * this file only carries identifiers, names, enabled flags, and per-kind
 * non-secret options. The two stores are joined by endpoint id.
 */

interface WebhookConfigFile {
	version: 1;
	endpoints: WebhookEndpointPublic[];
}

const DEFAULT_PATH = join(getVettaHomePath(), "desktop-app", "webhook-config.json");

export function defaultWebhookConfigPath(): string {
	return DEFAULT_PATH;
}

function emptyFile(): WebhookConfigFile {
	return { version: 1, endpoints: [] };
}

function isKnownKind(value: unknown): value is WebhookKind {
	return typeof value === "string" && (WEBHOOK_KINDS as readonly string[]).includes(value);
}

function sanitizeEndpoint(raw: Partial<WebhookEndpointPublic>): WebhookEndpointPublic | null {
	if (!raw || typeof raw !== "object") return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (!isKnownKind(raw.kind)) return null;
	const now = new Date().toISOString();
	const endpoint: WebhookEndpointPublic = {
		id: raw.id,
		kind: raw.kind,
		name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "未命名",
		enabled: Boolean(raw.enabled),
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
		urlMask: typeof raw.urlMask === "string" ? raw.urlMask : undefined,
		hasSignSecret: Boolean(raw.hasSignSecret),
	};
	if (raw.feishu && typeof raw.feishu === "object") {
		endpoint.feishu = {
			mentionAll: Boolean(raw.feishu.mentionAll),
		};
	}
	if (raw.dingtalk && typeof raw.dingtalk === "object") {
		const at = Array.isArray(raw.dingtalk.atMobiles)
			? raw.dingtalk.atMobiles.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
			: undefined;
		endpoint.dingtalk = {
			mentionAll: Boolean(raw.dingtalk.mentionAll),
			atMobiles: at && at.length > 0 ? at : undefined,
			keyword:
				typeof raw.dingtalk.keyword === "string" && raw.dingtalk.keyword.trim()
					? raw.dingtalk.keyword.trim()
					: undefined,
		};
	}
	return endpoint;
}

export function loadWebhookConfig(filePath = DEFAULT_PATH): WebhookEndpointPublic[] {
	if (!existsSync(filePath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<WebhookConfigFile>;
		if (!parsed || !Array.isArray(parsed.endpoints)) return [];
		const out: WebhookEndpointPublic[] = [];
		for (const raw of parsed.endpoints) {
			const ep = sanitizeEndpoint(raw);
			if (ep) out.push(ep);
		}
		return out;
	} catch {
		return [];
	}
}

export function saveWebhookConfig(endpoints: WebhookEndpointPublic[], filePath = DEFAULT_PATH): void {
	const file: WebhookConfigFile = { version: 1, endpoints };
	atomicWriteJSON(filePath, file);
}

export function defaultWebhookConfigFile(): WebhookConfigFile {
	return emptyFile();
}
