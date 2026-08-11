/**
 * 插件 CSS 编译成 `@scope ([data-vetta-plugin-root=vetta-ui-design])`，@scope 里的选择器
 * 匹配的是作用域根的**后代**，根自身不匹配。所以作用域根上不能挂 Tailwind 类。
 *
 * 这条约束犯过一次而且很难查：宿主自己的 Tailwind 里恰好也有 .fixed/.inset-0/.z-[1000]，
 * 类写在根上看着正常；直到用上宿主没有的 z-[1010]，只有那一条静默失效——二次确认框拿不到
 * z-index，被 z-1000 的宫格盖住，表面症状是「点了应用只有蒙层变黑」。这里把它钉死。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PluginPortal } from "../src/plugin-portal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

/** 递归收集 src 下的所有 .ts/.tsx。 */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(path));
		else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
	}
	return out;
}

it("作用域根只由 PluginPortal 产出，别处不许自己写", () => {
	const offenders = sourceFiles(join(import.meta.dirname, "../src"))
		.filter((path) => readFileSync(path, "utf8").includes("data-vetta-plugin-root"))
		.map((path) => path.replace(/.*\/src\//, "src/"));
	expect(offenders).toEqual(["src/plugin-portal.tsx"]);
});

it("作用域根不带任何 class，样式全部落在子元素上", () => {
	act(() => {
		root.render(
			<PluginPortal>
				<div className="fixed inset-0 z-[1010]">hi</div>
			</PluginPortal>,
		);
	});
	const scopeRoot = document.body.querySelector("[data-vetta-plugin-root]");
	if (!(scopeRoot instanceof HTMLElement)) throw new Error("scope root not rendered into body");
	expect(scopeRoot.parentElement).toBe(document.body);
	// 有 class 就说明有人又把样式写回了根上——那些类会静默丢掉。
	expect(scopeRoot.className).toBe("");
	// 根不参与布局：它只是作用域标记，不能吃掉 fixed 子层的定位上下文。
	expect(scopeRoot.style.display).toBe("contents");
	expect(scopeRoot.firstElementChild?.className).toBe("fixed inset-0 z-[1010]");
});
