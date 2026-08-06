/**
 * frame ↔ URL 映射（ADR-0055）。画布拼 iframe 地址、预览工具栏显示地址、以及
 * 引擎自己的路由表全部读同一份规则，映射错位的表现是「预览打开的是另一帧」。
 */
import { expect, it } from "vitest";
import { frameOfPath, homeFrameId, isFrameFile, pathOfFrame } from "../engine/src/routes";
import { frameUrl } from "../src/vetd/frame-url";

it("maps index to the site root and other frames to their own path", () => {
	expect(pathOfFrame("index")).toBe("/");
	expect(pathOfFrame("login")).toBe("/login");
});

it("resolves the home frame to index when it exists, first frame otherwise", () => {
	expect(homeFrameId(["dashboard", "index", "login"])).toBe("index");
	expect(homeFrameId(["dashboard", "login"])).toBe("dashboard");
	expect(homeFrameId([])).toBeNull();
});

it("parses a pathname back to a frame id", () => {
	const ids = ["index", "login"];
	expect(frameOfPath("/login", ids)).toBe("login");
	expect(frameOfPath("/login/", ids)).toBe("login");
	expect(frameOfPath("/", ids)).toBe("index");
	// 地址不在画框表里：预览的帧选择器要显示「未知」，而不是错挂到某一帧上。
	expect(frameOfPath("/checkout", ids)).toBeNull();
});

it("treats underscore-prefixed files as route structure, not frames", () => {
	// 漏掉这条的表现：画布上多出一个名为 _layout 的空画板，而它根本不是一屏内容。
	expect(isFrameFile("_layout.tsx")).toBe(false);
	expect(isFrameFile("login.tsx")).toBe(true);
	expect(isFrameFile("index.tsx")).toBe(true);
});

it("builds canvas iframe URLs with the reload nonce in the query string", () => {
	// nonce 必须是查询串：放 hash 只触发 hashchange，文档不会重新加载，刷新按钮就白点了。
	expect(frameUrl(5173, "login", 3)).toBe("http://127.0.0.1:5173/login?r=3");
	expect(frameUrl(5173, "index")).toBe("http://127.0.0.1:5173/");
});
