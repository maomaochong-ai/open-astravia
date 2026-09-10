/**
 * 装饰件（Ornament）：新会话页输入框上方那块「可任意替换的挂饰位」。
 *
 * 这里只定义「选了哪个」与目录元数据（标签/预览图），具体怎么画由各自的
 * preset 组件实现（见 domains/conversation/.../new-session/ornament）。
 * 目录放在 shared 是因为设置页与会话页两边都要读：设置页要标签和预览图，
 * 会话页只要 id。
 */

export type OrnamentId = "mario" | "none" | "orbit" | "torch" | "vivi";

export const ORNAMENT_STORAGE_KEY = "vetta-hero-ornament";

/** 默认挂上 Vivi：这是产品的 IP 形象，空着会让 hero 右下角显得没做完。 */
export const DEFAULT_ORNAMENT_ID: OrnamentId = "vivi";

export interface OrnamentCatalogEntry {
	/** i18n 描述文案（settings 命名空间）。 */
	readonly hintKey: string;
	readonly id: OrnamentId;
	/** i18n 名称文案（settings 命名空间）。 */
	readonly labelKey: string;
	/** 设置页卡片里的静态预览图；「无」没有预览。 */
	readonly preview?: string;
}

/** Vivi 静帧：与动画素材同目录，走 public 相对路径。 */
const VIVI_PREVIEW_URL = "./new-session/ferret.webp";

/**
 * 装饰件目录：新增装饰件只要在这里加一项，再在 ornament-registry 里挂上组件。
 * 保留 `as const` 是为了让 i18n key 收敛成字面量类型，`t()` 的键名校验才生效。
 */
export const ORNAMENT_CATALOG = [
	// preview 显式给 undefined：`as const` 下缺字段会让联合类型里读不到 preview。
	{ id: "none", labelKey: "ornamentNoneTitle", hintKey: "ornamentNoneHint", preview: undefined },
	{ id: "vivi", labelKey: "ornamentViviTitle", hintKey: "ornamentViviHint", preview: VIVI_PREVIEW_URL },
	// 星轨没有静帧可用：它是实时着色器，预览卡直接跑一枚小球，见 OrnamentPreview。
	{ id: "orbit", labelKey: "ornamentOrbitTitle", hintKey: "ornamentOrbitHint", preview: undefined },
	// 火把同理：整枚是 CSS 画出来的，预览卡直接画一根小的。
	{ id: "torch", labelKey: "ornamentTorchTitle", hintKey: "ornamentTorchHint", preview: undefined },
	// 马里奥同理：砖块是按点阵画的 SVG，预览卡直接画一排小的。
	{ id: "mario", labelKey: "ornamentMarioTitle", hintKey: "ornamentMarioHint", preview: undefined },
] as const satisfies readonly OrnamentCatalogEntry[];

export function isOrnamentId(value: string | null | undefined): value is OrnamentId {
	return ORNAMENT_CATALOG.some((entry) => entry.id === value);
}

export function getStoredOrnamentId(): OrnamentId {
	const stored = localStorage.getItem(ORNAMENT_STORAGE_KEY);
	return isOrnamentId(stored) ? stored : DEFAULT_ORNAMENT_ID;
}

export function setStoredOrnamentId(id: OrnamentId): void {
	localStorage.setItem(ORNAMENT_STORAGE_KEY, id);
}
