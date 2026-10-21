/**
 * iframe 消息信封（`{ astraviaDesign: true }`）。
 *
 * 回归的现场：一次批量品牌化改写把 `data.vetd` 换成了 `data.astravia-design`——也就是
 * `data.astravia - design`。三个接收点每来一条消息就抛 ReferenceError，于是 ready /
 * rendered / captured / navigated 全部静默丢失：截图 8 秒超时、缩略图空白、预览切帧
 * 无反应，而画面本身照常渲染，从表象几乎推不回根因。
 *
 * 所以这里既测信封本身，也测「源码里不再有手写的标记字面量」——单靠类型检查抓不到
 * 这类字符串漂移。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BRIDGE_MARKER, isBridgeMessage, withBridgeMarker } from "../engine/src/bridge-protocol";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 收发两端共用的源码：全部经由 bridge-protocol 的辅助函数，不得手写标记。 */
const BRIDGE_SOURCES = [
	"src/canvas/bridge-client.ts",
	"src/preview-mode/preview-client.ts",
	"src/preview/PreviewCanvas.tsx",
	"engine/src/bridge.ts",
];

it("accepts a marked envelope in both directions", () => {
	const ready = withBridgeMarker({ type: "ready" });
	expect(ready[BRIDGE_MARKER]).toBe(true);
	expect(isBridgeMessage(ready)).toBe(true);
	// 载荷字段不能覆盖标记
	expect(isBridgeMessage({ ...ready, path: "/cart" })).toBe(true);
	expect(isBridgeMessage(withBridgeMarker({ type: "navigate", to: "/login" }))).toBe(true);
});

it("rejects the broken kebab-case key and non-object payloads", () => {
	// 这正是那次改写留下的写法：`{"astravia-design": true}` 与 `data.astravia-design`。
	expect(isBridgeMessage({ "astravia-design": true, type: "ready" })).toBe(false);
	expect(isBridgeMessage({ astravia: {}, type: "ready" })).toBe(false);
	expect(isBridgeMessage({ ...withBridgeMarker({}), [BRIDGE_MARKER]: false })).toBe(false);
	expect(isBridgeMessage(null)).toBe(false);
	expect(isBridgeMessage(undefined)).toBe(false);
	expect(isBridgeMessage("astraviaDesign")).toBe(false);
});

it("keeps every bridge source on the shared helper", () => {
	for (const relative of BRIDGE_SOURCES) {
		const source = readFileSync(join(pluginRoot, relative), "utf8");
		// `data.astravia-design` 是 `data.astravia - design`，永远不该再出现。
		expect(source, relative).not.toContain(".astravia-design !== true");
		expect(source, relative).not.toMatch(/\.astravia-design\b/);
		// 标记只能由 withBridgeMarker 加上，源码里不再手写。
		expect(source, relative).not.toContain(`${BRIDGE_MARKER}: true`);
	}
});

it("keeps the injected page scripts in sync with the marker", () => {
	// 注入页面执行的脚本是源码字符串，取不到插件里的常量，只能靠这条断言盯住。
	const raster = readFileSync(join(pluginRoot, "src/canvas/offscreen-raster.ts"), "utf8");
	expect(BRIDGE_MARKER).toBe("astraviaDesign");
	expect(raster).toContain(`${BRIDGE_MARKER}: true`);
});
