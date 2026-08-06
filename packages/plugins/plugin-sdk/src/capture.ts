export interface PluginOffscreenCaptureOptions {
	/** 目标页面地址，仅允许 http(s)（如插件自己 spawn 的本地 dev server）。 */
	url: string;
	/** 视口宽度（CSS 像素）。 */
	width: number;
	/** 视口高度（CSS 像素）。 */
	height: number;
	/**
	 * 复用键。同 key 的请求串行执行并复用同一个离屏窗口：url 未变时跳过重新加载，
	 * SPA 页面可用 `prepareScript` 做客户端路由切换，省掉整页加载。省略则本次
	 * 请求独占一个窗口、用完即毁。窗口闲置一段时间后由宿主自动回收。
	 */
	sessionKey?: string;
	/** 页面加载完成（或复用窗口）后注入执行的脚本，如 postMessage 切路由。 */
	prepareScript?: string;
	/**
	 * 就绪表达式。宿主轮询它直到真值才截图，用于等待页面自己的「渲染完成」信号
	 * （如 `window.__ready === true`）。省略则加载完成即视为就绪。
	 */
	readyExpression?: string;
	/** 就绪后的静置时间（毫秒），等图片解码、过渡动画落定。 */
	settleMs?: number;
	/** 整体超时（毫秒，含加载与就绪等待），宿主按自身上限收紧。 */
	timeoutMs?: number;
	format?: "jpeg" | "png";
	/** 仅 jpeg 生效，0–1。 */
	quality?: number;
}

export interface PluginOffscreenCaptureResult {
	dataUrl: string;
	/**
	 * 实际生效的设备像素比：位图物理像素 = CSS 尺寸 × 此值。离屏窗口跟随主显示器
	 * 的缩放（Retina 为 2），插件不可指定——按需自行缩放位图。
	 */
	scaleFactor: number;
}

/**
 * 主进程离屏窗口截图。与 DOM 克隆类方案（html-to-image 等）不同，这里走真实的
 * Chromium 渲染管线，产出与页面在屏显示逐像素一致的位图，不存在克隆重排带来的
 * 断行/亚像素偏差。需要 `capture.offscreen` 权限。
 */
export interface PluginCaptureApi {
	offscreen(options: PluginOffscreenCaptureOptions): Promise<PluginOffscreenCaptureResult>;
	/** 释放 sessionKey 对应的离屏窗口；下次同 key 请求会重新加载页面。幂等。 */
	releaseOffscreen(sessionKey: string): Promise<void>;
}
