import type { PluginContext } from "@vetta-org/plugin-sdk";
import { parseRemoteCatalog } from "./remote-catalog";
import { setDesignSystems } from "./registry";
import type { DesignSystem } from "./types";

/**
 * 远端设计资源清单的同步。
 *
 * 用户不感知「源」的存在，所以这里全程静默：拉取失败、校验不通过、离线，都只是继续
 * 用上一份可用数据（缓存 → 内置），不弹提示、不显示错误态。
 *
 * 顺序是「先缓存后网络」：缓存命中就立刻替换（打开设计页不必等网络），随后网络结果
 * 再覆盖一次。
 */

/**
 * 候选源，按顺序尝试，第一个拿到且校验通过的生效。
 * 新增地址必须同时加进 plugin.json 的 `network.allowedHosts`（宿主按 host 白名单放行，
 * 且**每一跳重定向都会重新校验**，所以会跳转的地址要把跳转目标也声明上）。
 */
export const DESIGN_CATALOG_SOURCES: readonly string[] = [
	"https://raw.githubusercontent.com/openvetta/vetta-design-templates/main/.vetta/design-templates.json",
];

/** 上一次成功拉取到的清单原文，存插件私有 storage。 */
const CACHE_KEY = "design-catalog/latest";

const REQUEST_TIMEOUT_MS = 15_000;

interface CachedCatalog {
	/** 原样存下的清单对象，下次启动直接复用。 */
	catalog: unknown;
	fetchedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 从缓存恢复。返回是否成功替换了当前列表。 */
async function applyCached(ctx: PluginContext): Promise<boolean> {
	try {
		const cached = await ctx.storage.readJson<CachedCatalog>(CACHE_KEY);
		if (!isRecord(cached)) return false;
		const parsed = parseRemoteCatalog(cached.catalog);
		if (!parsed) return false;
		return setDesignSystems(parsed.systems);
	} catch {
		return false;
	}
}

/** 依次尝试候选源；成功则替换列表并写缓存。 */
async function applyRemote(ctx: PluginContext): Promise<DesignSystem[] | null> {
	for (const url of DESIGN_CATALOG_SOURCES) {
		try {
			const response = await ctx.network.request<unknown>({
				url,
				method: "GET",
				responseType: "json",
				timeoutMs: REQUEST_TIMEOUT_MS,
			});
			if (!response.ok) continue;
			const parsed = parseRemoteCatalog(response.body);
			if (!parsed) continue;
			if (!setDesignSystems(parsed.systems)) continue;
			await ctx.storage
				.writeJson(CACHE_KEY, { catalog: response.body, fetchedAt: new Date().toISOString() })
				.catch(() => {});
			return parsed.systems;
		} catch {
			// 单个源失败继续试下一个；全失败就保持现状。
		}
	}
	return null;
}

/**
 * 刷新设计体系列表。调用方不需要 await，也不需要处理失败——任何一步不成立都只是
 * 沿用当前列表。
 */
export async function refreshDesignCatalog(ctx: PluginContext): Promise<void> {
	await applyCached(ctx);
	await applyRemote(ctx);
}
