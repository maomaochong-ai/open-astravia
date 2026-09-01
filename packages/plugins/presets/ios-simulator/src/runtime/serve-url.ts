/**
 * baguette serve 的页面地址。
 *
 * 面板刻意直接内嵌 baguette 自带的 Web UI，而不是自己解码 MJPEG、自己发手势
 * 信封。两个原因，后者是硬性的：
 *
 * 1. 它自带的工具面远超我们能维护的范围——3D 机型与外框、旋转、摇一摇、
 *    状态栏覆盖、模拟定位、摄像头、无障碍检查器、实时日志、录制、H.264/MJPEG
 *    切换、全套硬件键、外接屏与 Apple Watch。重写一遍只会得到一个更差的子集。
 * 2. **serve 对 WebSocket 有 Origin 白名单**：只放行无 Origin 和 localhost 来源，
 *    其它 Origin 一律 400。浏览器发起的 WebSocket 必然带 Origin，所以从 Vetta
 *    renderer（origin 不是 localhost）直连流端点必然失败。iframe 里的页面来自
 *    127.0.0.1:<port>，属于同源，这条限制自然满足。
 *
 * 也就是说：想「自己画」就得让用户给 serve 传 --allowed-hosts 放宽来源，
 * 换来的却是更少的功能。不要走那条路。
 */

const HOST = "127.0.0.1";

/** 模拟器列表页。用于「在浏览器中打开」以及需要切换设备时。 */
export function buildSimulatorsUrl(port: number): string {
	return `http://${HOST}:${port}/simulators`;
}

/**
 * 单台设备的控制台（画面 + 工具栏）。面板直接进这里而不是列表页：
 * 列表页的 Stream 按钮走 window.open，webview 未开 allowpopups 会被拦下，
 * 点了没反应。直接导航到设备页则没有这个问题。
 */
export function buildDeviceUrl(port: number, udid: string): string {
	return `http://${HOST}:${port}/simulators/${encodeURIComponent(udid)}`;
}
