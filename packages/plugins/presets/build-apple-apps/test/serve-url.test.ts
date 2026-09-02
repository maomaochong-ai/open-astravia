import { describe, expect, it } from "vitest";
import { buildDeviceUrl, buildSimulatorsUrl } from "../src/runtime/serve-url.js";

describe("buildSimulatorsUrl", () => {
	it("points at the simulator list page on loopback", () => {
		expect(buildSimulatorsUrl(51234)).toBe("http://127.0.0.1:51234/simulators");
	});

	it("stays on 127.0.0.1 so the embedded page is same-origin with the stream socket", () => {
		// serve 只放行无 Origin 与 localhost 来源的 WebSocket；换成别的 host
		// 会让 iframe 内的流握手拿到 400。
		expect(buildSimulatorsUrl(1)).toMatch(/^http:\/\/127\.0\.0\.1:/);
	});
});

describe("buildDeviceUrl", () => {
	it("targets one device's console directly", () => {
		// 面板不落在列表页：列表页的 Stream 按钮走 window.open，webview 会拦掉。
		expect(buildDeviceUrl(51234, "ABC-123")).toBe("http://127.0.0.1:51234/simulators/ABC-123");
	});

	it("escapes the udid", () => {
		expect(buildDeviceUrl(1, "a/b")).toContain("/simulators/a%2Fb");
	});
});
