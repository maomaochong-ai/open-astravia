import type { CacheRetention } from "../../types.js";

export type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" };

export function getCacheControl(
	baseUrl: string,
	cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: AnthropicCacheControl } {
	const retention = resolveCacheRetention(cacheRetention);
	if (retention === "none") return { retention };

	const ttl = retention === "long" && baseUrl.includes("api.anthropic.com") ? "1h" : undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) return cacheRetention;
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") return "long";
	return "short";
}
