/**
 * 设计体系的公开入口。
 *
 * 数据只来自远端资源仓库（`catalog-sync.ts` 拉取、`remote-catalog.ts` 校验，缓存在插件
 * 私有 storage）。插件不随包内置任何一套，所以「一套都没有」是真实状态：读列表的地方
 * 用 `designSystems()`，需要区分「还在拉」和「拉失败」的 UI 用 `useCatalogState()`。
 */
export { DESIGN_CATALOG_SOURCES, refreshDesignCatalog } from "./catalog-sync";
export { designSystemCategoryLabel, designSystemTagline } from "./labels";
export { parseRemoteCatalog } from "./remote-catalog";
export {
	type CatalogState,
	type CatalogStatus,
	catalogState,
	designSystemById,
	designSystems,
	markCatalogFailed,
	markCatalogLoading,
	resetDesignSystems,
	setDesignSystems,
	subscribeDesignSystems,
	useCatalogState,
	useDesignSystems,
} from "./registry";
export type { DesignSystem } from "./types";
