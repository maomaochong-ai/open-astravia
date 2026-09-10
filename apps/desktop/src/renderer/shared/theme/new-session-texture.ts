import { AuroraTexture } from "@shared/components/aurora/AuroraTexture";
import { NewSessionBackground } from "@vetta/theme-ui/chat";
import type { ComponentType } from "react";

/**
 * 纹理（Texture）：新会话页整页背后那层底衬。
 *
 * 与装饰件（见 `ornament.ts`）同构：这里只定义「选了哪个」与目录元数据，
 * 纹理本身由 theme-ui 提供。
 * 目录与实现表都放在 shared：会话页要按 id 铺，设置页要按同一张表画预览，
 * 两边共用一份表才不会出现「预览与页面对不上」。
 */

export type NewSessionTextureId = "aurora" | "grid" | "none";

export const NEW_SESSION_TEXTURE_STORAGE_KEY = "vetta-new-session-texture";

/** 默认铺「网格」：这是纹理可选之前一直在用的那层，老用户升级后观感不变。 */
export const DEFAULT_NEW_SESSION_TEXTURE_ID: NewSessionTextureId = "grid";

export interface NewSessionTextureCatalogEntry {
	/** i18n 描述文案（settings 命名空间）。 */
	readonly hintKey: string;
	readonly id: NewSessionTextureId;
	/** i18n 名称文案（settings 命名空间）。 */
	readonly labelKey: string;
}

/**
 * 纹理目录：新增纹理只要在这里加一项，再在 texture-registry 里挂上组件。
 * 保留 `as const` 是为了让 i18n key 收敛成字面量类型，`t()` 的键名校验才生效。
 */
export const NEW_SESSION_TEXTURE_CATALOG = [
	{ id: "none", labelKey: "textureNoneTitle", hintKey: "textureNoneHint" },
	{ id: "grid", labelKey: "textureGridTitle", hintKey: "textureGridHint" },
	{ id: "aurora", labelKey: "textureAuroraTitle", hintKey: "textureAuroraHint" },
] as const satisfies readonly NewSessionTextureCatalogEntry[];

export function isNewSessionTextureId(value: string | null | undefined): value is NewSessionTextureId {
	return NEW_SESSION_TEXTURE_CATALOG.some((entry) => entry.id === value);
}

export function getStoredNewSessionTextureId(): NewSessionTextureId {
	const stored = localStorage.getItem(NEW_SESSION_TEXTURE_STORAGE_KEY);
	return isNewSessionTextureId(stored) ? stored : DEFAULT_NEW_SESSION_TEXTURE_ID;
}

export function setStoredNewSessionTextureId(id: NewSessionTextureId): void {
	localStorage.setItem(NEW_SESSION_TEXTURE_STORAGE_KEY, id);
}

/**
 * 纹理实现表：id → 组件。`null` 表示这一档整块背景什么都不画（「无」）。
 *
 * 新增纹理：在上面的目录里加一项（决定设置页怎么展示），再在这里挂上组件
 * （决定怎么画）。两处都以 id 对齐，漏一处会有类型报错。
 * 一档纹理是一整套背景观感——网格连同页面中间那团光晕都属于「网格」这档，
 * 不拆成「底纹 + 常驻光晕」，否则选「无」还会剩下半层，不是用户要的空白。
 * 纹理组件按绝对定位铺满所在容器。
 */
export const NEW_SESSION_TEXTURE_COMPONENTS: Record<NewSessionTextureId, ComponentType | null> = {
	aurora: AuroraTexture,
	grid: NewSessionBackground,
	none: null,
};
