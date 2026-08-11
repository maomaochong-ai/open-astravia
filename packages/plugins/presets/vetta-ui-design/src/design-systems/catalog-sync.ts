import type { PluginContext } from "@vetta-org/plugin-sdk";
import { parseRemoteCatalog } from "./remote-catalog";
import { setDesignSystems } from "./registry";

/**
 * 远端设计资源清单的同步。
 *
 * 用户不感知「源」的存在，所以这里全程静默：拉取失败、校验不通过、离线，都只是继续
 * 用上一份可用数据（缓存 → 内置），不弹提示、不显示错误态。
 *
 * 请求预算：缓存在 TTL 内**一个请求都不发**；过期后带 If-None-Match 条件请求，内容没
 * 变时服务端只回 304（几百字节）。所以稳定状态下每个用户每 TTL 最多一次轻量请求。
 */

/**
 * 候选源，按顺序尝试，第一个拿到且校验通过的生效。
 *
 * jsDelivr 排前面：它是专门做这件事的免费 CDN，把流量从 GitHub 挪走，国内可达性通常
 * 也比 raw 好；代价是 CDN 侧缓存 12 小时（`s-maxage=43200`），内容更新最多晚半天生效。
 * raw 兜底：5 分钟就新鲜，jsDelivr 挂了或还没回源时顶上。
 *
 * 新增地址必须同时加进 plugin.json 的 `network.allowedHosts`（宿主按 host 白名单放行，
 * 且**每一跳重定向都会重新校验**，所以会跳转的地址要把跳转目标也声明上）。
 */
export const DESIGN_CATALOG_SOURCES: readonly string[] = [
	"https://cdn.jsdelivr.net/gh/openvetta/vetta-design-templates@main/.vetta/design-templates.json",
	"https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json",
];

/** 上一次成功拉取到的清单原文，存插件私有 storage。 */
const CACHE_KEY = "design-catalog/latest";

/** 缓存多久之内不再发请求。设计资源不是时效内容，半天一次足够。 */
const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

interface CachedCatalog {
	/** 原样存下的清单对象，下次启动直接复用。 */
	catalog: unknown;
	fetchedAt: string;
	/** 这份缓存来自哪个源，以及它的 ETag——只对同一个源做条件请求。 */
	sourceUrl?: string;
	etag?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asCache(value: unknown): CachedCatalog | null {
	if (!isRecord(value)) return null;
	if (typeof value.fetchedAt !== "string") return null;
	return value as unknown as CachedCatalog;
}

/** 缓存是否还在 TTL 内（在的话这一轮完全不联网）。 */
export function isCacheFresh(fetchedAt: string, now: number, ttlMs: number = REFRESH_TTL_MS): boolean {
	const stamp = Date.parse(fetchedAt);
	if (!Number.isFinite(stamp)) return false;
	const age = now - stamp;
	// 时钟回拨会让 age 为负；这种情况按「已过期」处理，宁可多发一次请求。
	return age >= 0 && age < ttlMs;
}

/** 响应头大小写不固定，取值时统一小写匹配。 */
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	const hit = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
	return hit?.[1];
}

/** 依次尝试候选源；成功则替换列表并写缓存。 */
async function applyRemote(ctx: PluginContext, cached: CachedCatalog | null, now: number): Promise<boolean> {
	for (const url of DESIGN_CATALOG_SOURCES) {
		try {
			// ETag 只在同源之间有意义：换了源，服务端不认识上一个源发的标识。
			const conditional = cached?.sourceUrl === url && cached.etag ? { "if-none-match": cached.etag } : undefined;
			const response = await ctx.network.request<unknown>({
				url,
				method: "GET",
				responseType: "json",
				timeoutMs: REQUEST_TIMEOUT_MS,
				headers: conditional,
			});

			// 内容没变：不重新解析，只把「刚查过」记下来，下一个 TTL 周期前不再打扰。
			if (response.status === 304 && cached) {
				await ctx.storage
					.writeJson(CACHE_KEY, { ...cached, fetchedAt: new Date(now).toISOString() })
					.catch(() => {});
				return true;
			}
			if (!response.ok) continue;

			const parsed = parseRemoteCatalog(response.body);
			if (!parsed) continue;
			if (!setDesignSystems(parsed.systems)) continue;
			await ctx.storage
				.writeJson(CACHE_KEY, {
					catalog: response.body,
					fetchedAt: new Date(now).toISOString(),
					sourceUrl: url,
					etag: headerValue(response.headers, "etag"),
				} satisfies CachedCatalog)
				.catch(() => {});
			return true;
		} catch {
			// 单个源失败继续试下一个；全失败就保持现状。
		}
	}
	return false;
}

/**
 * 刷新设计体系列表。调用方不需要 await，也不需要处理失败——任何一步不成立都只是
 * 沿用当前列表。
 *
 * `now` 是本轮唯一的时间源：新鲜度判断和写回的 `fetchedAt` 必须来自同一个读数，
 * 否则「刚写的缓存」可能立刻被判成过期。
 */
export async function refreshDesignCatalog(ctx: PluginContext, now: number = Date.now()): Promise<void> {
	let cached: CachedCatalog | null = null;
	try {
		cached = asCache(await ctx.storage.readJson<CachedCatalog>(CACHE_KEY));
	} catch {
		cached = null;
	}

	if (cached) {
		const parsed = parseRemoteCatalog(cached.catalog);
		if (parsed) {
			setDesignSystems(parsed.systems);
			// 缓存还新鲜就到此为止：这是把请求量从「每次启动」压到「每 TTL 一次」的关键。
			if (isCacheFresh(cached.fetchedAt, now)) return;
		} else {
			// 缓存内容已经不可用（格式变了/坏了），别拿它的 ETag 去做条件请求。
			cached = null;
		}
	}

	await applyRemote(ctx, cached, now);
}
