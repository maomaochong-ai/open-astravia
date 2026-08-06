/**
 * 品类 → 默认画框尺寸。
 *
 * 为什么这张表要在代码里再存一份（SKILL.md 的「Pick the product type」已经有了）：
 * 工具描述每轮都在系统提示里，skill 正文只有 invoke_skill 那一次。把常用尺寸挂在
 * `vetd_create` 的参数上，模型不翻 skill 也能把品类说清楚。
 *
 * 表里只收「有公认默认值」的品类。信息图那一行 SKILL.md 写的是 free——没有默认值
 * 的枚举项等于骗人，这种直接走 `frameSize` 给数字。A4/Letter 之类的物理尺寸同理，
 * 换算成 px 后走 `frameSize`。
 */
import type { FrameSize } from "./manifest-types";

export const PRODUCT_SIZES = {
	mobile: { width: 390, height: 844 },
	desktop: { width: 1440, height: 900 },
	landing: { width: 1440, height: 2400 },
	slide: { width: 1920, height: 1080 },
	poster: { width: 1080, height: 1440 },
} as const satisfies Record<string, FrameSize>;

export type ProductType = keyof typeof PRODUCT_SIZES;

export const PRODUCT_TYPES = Object.keys(PRODUCT_SIZES) as ProductType[];

/** 工具描述里那句枚举说明，避免尺寸在两处各写一遍。 */
export const PRODUCT_SIZE_SUMMARY = PRODUCT_TYPES.map(
	(type) => `${type} ${PRODUCT_SIZES[type].width}x${PRODUCT_SIZES[type].height}`,
).join(", ");

/** 正整数才算数：负数/小数/NaN 落到画布上是一个畸形画板，不如当没给。 */
function validSize(size: unknown): FrameSize | null {
	if (typeof size !== "object" || size === null) return null;
	const { width, height } = size as { width?: unknown; height?: unknown };
	if (typeof width !== "number" || typeof height !== "number") return null;
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return { width: Math.round(width), height: Math.round(height) };
}

/**
 * 创建时声明的默认尺寸。显式尺寸优先于品类：用户点名 800x800 就是 800x800，品类
 * 只是速记。两个都没给（或给的是垃圾值）返回 null，由调用方决定怎么处理。
 */
export function resolveDefaultFrameSize(input: {
	product?: unknown;
	frameSize?: unknown;
}): FrameSize | null {
	const explicit = validSize(input.frameSize);
	if (explicit) return explicit;
	const product = input.product;
	if (typeof product === "string" && product in PRODUCT_SIZES) {
		return PRODUCT_SIZES[product as ProductType];
	}
	return null;
}
