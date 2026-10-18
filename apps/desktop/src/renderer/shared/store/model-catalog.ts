import type { ModelsConfigData } from "@preload/api";
import { getDefaultStore } from "jotai";
import { isCloudBuildEnabled } from "@/shared/feature-flags";
import { localModelsConfigAtom, remoteProvidersAtom } from "./model-catalog-atoms";
import { createModelCatalogSync, type ModelCatalogSync } from "./model-catalog-sync";

export { localModelsConfigAtom } from "./model-catalog-atoms";

/**
 * 应用级模型目录同步器：本地 models.json + 远程 provider catalog。
 *
 * 采用 stale-while-revalidate——打开模型 popover、窗口重新获得焦点时按 TTL
 * 后台重拉，先展示旧值再无感替换。这样服务端增删模型后不必重启应用。
 */
export const modelCatalog: ModelCatalogSync = createModelCatalogSync<ModelsConfigData, Record<string, unknown>>({
	now: () => Date.now(),
	loadLocal: () => window.astravia.models.get(),
	applyLocal: (config) => getDefaultStore().set(localModelsConfigAtom, config),
	loadRemote: async () => {
		// lite 构建（默认形态）里云服务被常量折叠掉了，主进程根本没有这个通道：
		// 调一次就是一条 "No handler registered" 错误，且每轮 TTL 过期都会重来。
		if (!isCloudBuildEnabled()) return null;
		// 未登录时主进程直接返回空目录（不发网络请求），写回空表正好与登出行为一致。
		const result = await window.astravia.models.fetchRemote();
		return (result.providers ?? {}) as Record<string, unknown>;
	},
	applyRemote: (providers) => getDefaultStore().set(remoteProvidersAtom, providers),
	onError: (source, error) => {
		console.warn(`[modelCatalog] ${source} 目录刷新失败，继续沿用上次结果：`, error);
	},
});
