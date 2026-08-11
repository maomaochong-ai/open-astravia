/**
 * 设计体系的公开入口。
 *
 * 数据有两个来源：随插件打包的内置那份（`builtin.ts`），以及远端资源仓库
 * （`catalog-sync.ts` 拉取、`remote-catalog.ts` 校验）。消费方一律通过这里的同步
 * 读取函数取值，不关心当前生效的是哪一份。
 */
export { BUILTIN_DESIGN_SYSTEMS, DESIGN_SYSTEMS_SOURCE } from "./builtin";
export { DESIGN_CATALOG_SOURCES, refreshDesignCatalog } from "./catalog-sync";
export { parseRemoteCatalog } from "./remote-catalog";
export {
	designSystemById,
	designSystems,
	resetDesignSystems,
	setDesignSystems,
	subscribeDesignSystems,
	useDesignSystems,
} from "./registry";
export type { DesignSystem } from "./types";
