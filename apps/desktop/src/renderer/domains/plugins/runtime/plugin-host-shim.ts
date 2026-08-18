import { installViteFederationSharedCache, pluginHostShimModules } from "./plugin-shared-modules";

interface ModuleFederationModuleCache {
	share: Record<string, unknown>;
	remote: Record<string, unknown>;
}

declare global {
	/**
	 * `vetta-host://*` shim（`main/plugins/plugin-protocol.ts`）在插件模块求值时读这个
	 * 全局对象。类型与赋值都直接取自 {@link pluginHostShimModules}——**不要**在这里重抄
	 * 一份字段清单：抄漏一个（历史上漏过 `themeUiPlugin`）不会有任何类型错误，
	 * 只会在插件加载时炸 `Cannot read properties of undefined`，整个插件静默消失。
	 */
	var __VETTA_PLUGIN_HOST__: typeof pluginHostShimModules | undefined;
	var __mf_module_cache__: ModuleFederationModuleCache | undefined;
}

export function installPluginHostShim(): void {
	globalThis.__VETTA_PLUGIN_HOST__ = { ...pluginHostShimModules };

	if (!globalThis.__mf_module_cache__) {
		globalThis.__mf_module_cache__ = { share: {}, remote: {} };
	}
	const moduleCache = globalThis.__mf_module_cache__;
	moduleCache.share ??= {};
	moduleCache.remote ??= {};
	installViteFederationSharedCache(moduleCache.share);
}
