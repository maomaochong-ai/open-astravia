/** 预览视口：默认跟随画框声明尺寸，另给几档常见设备尺寸，用户还可以自己拉伸。 */

export interface ViewportSize {
	width: number;
	height: number;
}

export interface ViewportPreset extends ViewportSize {
	id: string;
	/** i18n key，模块级常量不存文案本身。 */
	labelKey: string;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
	{ id: "mobile", labelKey: "previewMode.viewport.mobile", width: 390, height: 844 },
	{ id: "tablet", labelKey: "previewMode.viewport.tablet", width: 834, height: 1112 },
	{ id: "desktop", labelKey: "previewMode.viewport.desktop", width: 1440, height: 900 },
];

/** 手动拉伸的下限，再小就只剩滚动条了。 */
export const MIN_VIEWPORT: ViewportSize = { width: 240, height: 240 };

/**
 * 窗口能给出的舞台尺寸。工具栏、外边距与遮罩内边距都要扣掉，否则初始视口一上来
 * 就超出可视区、每次打开都得先滚一下。
 */
export function availableViewport(): ViewportSize {
	return {
		width: Math.max(MIN_VIEWPORT.width, window.innerWidth - 96),
		height: Math.max(MIN_VIEWPORT.height, window.innerHeight - 168),
	};
}

/**
 * 初始视口 = 画框声明尺寸，但夹到窗口装得下的范围内。
 *
 * 1440×900 的桌面稿在小屏上会被夹窄——这与真实浏览器窗口不够大是同一件事，
 * 用户拉伸或切预设即可，比一上来就出现双向滚动条诚实。
 */
export function clampToAvailable(size: ViewportSize): ViewportSize {
	const available = availableViewport();
	return {
		width: Math.max(MIN_VIEWPORT.width, Math.min(size.width, available.width)),
		height: Math.max(MIN_VIEWPORT.height, Math.min(size.height, available.height)),
	};
}
