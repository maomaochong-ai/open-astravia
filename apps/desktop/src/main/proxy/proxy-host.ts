/**
 * 应用代理在桌面端的装配点：把 desktop-config 与 models.json 接到 proxy-runtime。
 */

import { readDesktopConfig } from "../config/desktop-config-store.js";
import { readModelsConfigSync } from "../models/model-settings-service.js";
import { applyDesktopProxy } from "./proxy-runtime.js";

/**
 * 供应商开关快照。解析器在每次模型请求时被调用，不能每次都同步读一遍
 * models.json；改动由 `invalidateProxyProviderRouting()` 通知。
 */
let providerUseProxyCache: Map<string, boolean | undefined> | undefined;

function readProviderUseProxy(providerId: string): boolean | undefined {
	if (!providerUseProxyCache) {
		providerUseProxyCache = new Map(
			Object.entries(readModelsConfigSync().providers).map(([id, provider]) => [id, provider.useProxy]),
		);
	}
	return providerUseProxyCache.get(providerId);
}

/** models.json 变更后调用；下次模型请求会重新读取供应商开关。 */
export function invalidateProxyProviderRouting(): void {
	providerUseProxyCache = undefined;
}

/** 启动时与每次代理配置变更后调用。 */
export async function refreshDesktopProxy(): Promise<void> {
	invalidateProxyProviderRouting();
	const config = await readDesktopConfig();
	await applyDesktopProxy(config.proxy, { readProviderUseProxy });
}
