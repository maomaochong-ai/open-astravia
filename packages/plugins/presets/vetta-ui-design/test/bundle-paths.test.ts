/**
 * 设计包内路径的影响面判定。这条规则原本长在 DesignCanvas 的「源码变了要重截」
 * 里，活动态那边则只认 `frames/*.tsx`，两处对同一件事有两套答案——抽出来之后由
 * 这组用例钉死唯一的说法。
 */
import { expect, it } from "vitest";
import { classifySource } from "../src/vetd/bundle-paths";

it("a frame source only affects its own frame", () => {
	expect(classifySource("frames/home.tsx")).toEqual({ kind: "frame", frameId: "home" });
	expect(classifySource("frames/index.tsx")).toEqual({ kind: "frame", frameId: "index" });
});

it("treats `_`-prefixed files under frames/ as shared chrome, not as a frame", () => {
	// 引擎不给 `_` 开头的文件派路由，画布也不给它建画板（engine/src/routes.isFrameFile）。
	// 它是所有 frame 的公共外壳，改它等于改了每一屏。
	expect(classifySource("frames/_layout.tsx")).toEqual({ kind: "shared" });
});

it("treats every other source in the bundle as shared", () => {
	expect(classifySource("components/Shell.tsx")).toEqual({ kind: "shared" });
	expect(classifySource("theme.css")).toEqual({ kind: "shared" });
	expect(classifySource("assets/logo.png")).toEqual({ kind: "shared" });
	// frames/ 下的嵌套文件不是画框（reconcile 只扫平铺的一层），当共享件处理。
	expect(classifySource("frames/parts/Card.tsx")).toEqual({ kind: "shared" });
});

it("ignores generated files and docs — they never change what a frame renders", () => {
	expect(classifySource("design.json")).toEqual({ kind: "none" });
	expect(classifySource(".notes.json")).toEqual({ kind: "none" });
	expect(classifySource(".snapshots/home-123.png")).toEqual({ kind: "none" });
	expect(classifySource(".vetd-build/x.js")).toEqual({ kind: "none" });
	expect(classifySource("node_modules/react/index.js")).toEqual({ kind: "none" });
	expect(classifySource("DESIGN.md")).toEqual({ kind: "none" });
});

it("normalises Windows separators", () => {
	expect(classifySource("frames\\home.tsx")).toEqual({ kind: "frame", frameId: "home" });
	expect(classifySource(".snapshots\\home-1.png")).toEqual({ kind: "none" });
});
