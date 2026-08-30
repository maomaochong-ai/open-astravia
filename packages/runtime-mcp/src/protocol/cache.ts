import type { McpMeta } from "./json.js";

export type McpCacheScope = "public" | "private";

/**
 * Cache metadata required by cacheable results in MCP 2026-07-28.
 *
 * Legacy results omit these fields, so transport-neutral result types intersect this contract
 * only after a Modern-era guard has validated the wire payload.
 */
export interface McpCacheableResult {
	readonly resultType: "complete";
	readonly ttlMs: number;
	readonly cacheScope: McpCacheScope;
	readonly _meta?: McpMeta;
}

export function isMcpCacheableResult(value: unknown): value is McpCacheableResult {
	if (!isRecord(value) || value.resultType !== "complete") return false;
	if (!Number.isInteger(value.ttlMs) || (value.ttlMs as number) < 0) return false;
	return value.cacheScope === "public" || value.cacheScope === "private";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
