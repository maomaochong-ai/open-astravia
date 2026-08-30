import { createHash } from "node:crypto";
import type { McpCacheableResult, McpJsonObject } from "@vetta/runtime-mcp/protocol";
import { isMcpCacheableResult } from "@vetta/runtime-mcp/protocol";

interface CacheEntry {
	readonly expiresAt: number;
	readonly value: McpCacheableResult;
}

/** Per-client cache. Private entries are partitioned by a one-way authorization fingerprint. */
export class CacheableMcpResultStore {
	private readonly entries = new Map<string, CacheEntry>();

	get(method: string, fields: McpJsonObject, headers: HeadersInit, now = Date.now()): McpCacheableResult | undefined {
		const base = createBaseKey(method, fields);
		for (const key of [`public:${base}`, `private:${authFingerprint(headers)}:${base}`]) {
			const entry = this.entries.get(key);
			if (!entry) continue;
			if (entry.expiresAt <= now) {
				this.entries.delete(key);
				continue;
			}
			return entry.value;
		}
		return undefined;
	}

	set(method: string, fields: McpJsonObject, headers: HeadersInit, value: unknown, now = Date.now()): void {
		if (!isMcpCacheableResult(value) || value.ttlMs <= 0) return;
		const partition = value.cacheScope === "private" ? `private:${authFingerprint(headers)}` : "public";
		this.entries.set(`${partition}:${createBaseKey(method, fields)}`, {
			expiresAt: now + value.ttlMs,
			value,
		});
	}

	clear(): void {
		this.entries.clear();
	}
}

function createBaseKey(method: string, fields: McpJsonObject): string {
	return `${method}:${stableStringify(fields)}`;
}

function authFingerprint(headers: HeadersInit): string {
	const authorization = new Headers(headers).get("authorization") ?? "anonymous";
	return createHash("sha256").update(authorization).digest("hex");
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (!value || typeof value !== "object") return JSON.stringify(value);
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}
