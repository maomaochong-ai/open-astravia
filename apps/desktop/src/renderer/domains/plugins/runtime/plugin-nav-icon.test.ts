// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { acquireNavIconClass, classifyPluginNavIcon, navIconMaskRule, resolveNavIcon } from "./plugin-nav-icon";

/** Parse a rule the way the browser will, to prove a hostile url cannot escape it. */
function parsedRules(cssText: string): CSSRuleList {
	const style = document.createElement("style");
	style.textContent = cssText;
	document.head.append(style);
	const rules = (style.sheet as CSSStyleSheet).cssRules;
	style.remove();
	return rules;
}

function injectedRules(): string[] {
	return [...document.head.querySelectorAll("style[data-vetta-plugin-nav-icon]")].map(
		(style) => style.textContent ?? "",
	);
}

describe("classifyPluginNavIcon", () => {
	it("passes through Tailwind Iconify utilities", () => {
		expect(classifyPluginNavIcon("icon-[solar--crown-line-linear]")).toEqual({
			kind: "class",
			value: "icon-[solar--crown-line-linear]",
		});
		expect(classifyPluginNavIcon("  icon-[solar--star-bold]  ")).toEqual({
			kind: "class",
			value: "icon-[solar--star-bold]",
		});
	});

	it("converts legacy `set:name` Iconify references", () => {
		expect(classifyPluginNavIcon("solar:star-bold")).toEqual({ kind: "class", value: "icon-[solar--star-bold]" });
	});

	it("treats resolved package paths and remote images as images", () => {
		expect(classifyPluginNavIcon("vetta-plugin://chinese-chess/assets/logo.svg?v=0.1.0")).toEqual({
			kind: "image",
			url: "vetta-plugin://chinese-chess/assets/logo.svg?v=0.1.0",
		});
		expect(classifyPluginNavIcon("https://example.com/logo.png")).toEqual({
			kind: "image",
			url: "https://example.com/logo.png",
		});
		expect(classifyPluginNavIcon("data:image/svg+xml,%3Csvg%3E")).toEqual({
			kind: "image",
			url: "data:image/svg+xml,%3Csvg%3E",
		});
	});

	it("returns null for missing or blank icons", () => {
		expect(classifyPluginNavIcon(undefined)).toBeNull();
		expect(classifyPluginNavIcon("   ")).toBeNull();
	});
});

describe("navIconMaskRule", () => {
	it("masks the image with currentColor so it follows the theme", () => {
		const rule = navIconMaskRule("vetta-plugin-nav-icon-1", "vetta-plugin://p/logo.svg");
		expect(rule).toContain("background-color:currentColor");
		expect(rule).toContain('mask-image:url("vetta-plugin://p/logo.svg")');
		expect(rule).toContain("-webkit-mask-image:");
	});

	it("quotes the url so a hostile value cannot escape into a second rule", () => {
		const rule = navIconMaskRule("c", 'a.svg");}body{display:none;}/*');
		const parsed = parsedRules(rule);
		expect(parsed).toHaveLength(1);
		expect((parsed[0] as CSSStyleRule).selectorText).toBe(".c");
	});
});

describe("acquireNavIconClass", () => {
	it("injects one mask rule and returns its class name", () => {
		const handle = acquireNavIconClass("vetta-plugin://p/a.svg");
		expect(handle.className).toMatch(/^vetta-plugin-nav-icon-\d+$/);
		expect(injectedRules()).toHaveLength(1);
		expect(injectedRules()[0]).toContain(handle.className);
		handle.release();
		expect(injectedRules()).toHaveLength(0);
	});

	it("shares one rule between identical urls and only drops it when all holders release", () => {
		const first = acquireNavIconClass("vetta-plugin://p/shared.svg");
		const second = acquireNavIconClass("vetta-plugin://p/shared.svg");
		expect(second.className).toBe(first.className);
		expect(injectedRules()).toHaveLength(1);

		first.release();
		expect(injectedRules()).toHaveLength(1);
		second.release();
		expect(injectedRules()).toHaveLength(0);
	});

	it("gives different urls different classes", () => {
		const a = acquireNavIconClass("vetta-plugin://p/a.svg");
		const b = acquireNavIconClass("vetta-plugin://p/b.svg");
		expect(a.className).not.toBe(b.className);
		expect(injectedRules()).toHaveLength(2);
		a.release();
		b.release();
	});

	it("ignores extra releases instead of removing a live rule", () => {
		const handle = acquireNavIconClass("vetta-plugin://p/once.svg");
		handle.release();
		handle.release();
		const again = acquireNavIconClass("vetta-plugin://p/once.svg");
		expect(injectedRules()).toHaveLength(1);
		again.release();
		expect(injectedRules()).toHaveLength(0);
	});
});

describe("resolveNavIcon", () => {
	it("tints an image by default and exposes no image url", () => {
		const resolved = resolveNavIcon("vetta-plugin://p/logo.svg", true);
		expect(resolved?.className).toMatch(/^vetta-plugin-nav-icon-\d+$/);
		expect(resolved?.imageUrl).toBeUndefined();
		expect(injectedRules()).toHaveLength(1);
		resolved?.release();
		expect(injectedRules()).toHaveLength(0);
	});

	it("returns the image url untinted AND still a mask class for older themes", () => {
		const resolved = resolveNavIcon("vetta-plugin://p/logo.png", false);
		expect(resolved?.imageUrl).toBe("vetta-plugin://p/logo.png");
		// The class is the fallback for themes that do not know `iconUrl`.
		expect(resolved?.className).toMatch(/^vetta-plugin-nav-icon-\d+$/);
		expect(injectedRules()).toHaveLength(1);
		resolved?.release();
	});

	it("ignores tint for Iconify classes, which are always tinted", () => {
		const resolved = resolveNavIcon("icon-[solar--crown-linear]", false);
		expect(resolved).toEqual({ className: "icon-[solar--crown-linear]", release: expect.any(Function) });
		expect(injectedRules()).toHaveLength(0);
		resolved?.release();
	});

	it("returns null when there is no icon to resolve", () => {
		expect(resolveNavIcon(undefined, true)).toBeNull();
		expect(resolveNavIcon("  ", false)).toBeNull();
	});
});
