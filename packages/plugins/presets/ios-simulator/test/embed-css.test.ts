import { describe, expect, it } from "vitest";
import {
	BACK_LINK_MAX_WIDTH_PX,
	buildEmbedCss,
	FALLBACK_THEME,
	type HostTheme,
	RAILS_MAX_WIDTH_PX,
} from "../src/runtime/embed-css.js";

const THEME: HostTheme = {
	background: "#101014",
	foreground: "#eeeeee",
	card: "#1b1b20",
	border: "#33333a",
	mutedForeground: "#8a8a92",
	accent: "#4f8cff",
	dark: true,
};

function mediaBlock(css: string, maxWidth: number): string {
	const match = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([\\s\\S]*?)\\n\\}`));
	return match?.[1] ?? "";
}

describe("buildEmbedCss — 配色", () => {
	it("repaints all three layers that actually draw the background", () => {
		// 实测：背景由 html、body 和全屏 fixed 底板 #simNativeView 三层绘制，
		// 只覆盖其中一层会露出 baguette 自己的浅色底。
		const rule = buildEmbedCss(THEME).match(/html, body, #simNativeView \{([^}]*)\}/);
		expect(rule?.[1]).toContain(`background: ${THEME.background} !important`);
	});

	it("maps the host palette onto the page's own custom properties", () => {
		const css = buildEmbedCss(THEME);
		expect(css).toContain(`--bg: ${THEME.background}`);
		expect(css).toContain(`--panel: ${THEME.card}`);
		expect(css).toContain(`--text: ${THEME.foreground}`);
		expect(css).toContain(`--accent: ${THEME.accent}`);
	});

	it("follows the host's light/dark mode via color-scheme", () => {
		expect(buildEmbedCss(THEME)).toContain("color-scheme: dark");
		expect(buildEmbedCss({ ...THEME, dark: false })).toContain("color-scheme: light");
	});

	it("ships a usable fallback palette for when host variables cannot be read", () => {
		expect(buildEmbedCss(FALLBACK_THEME)).toContain(FALLBACK_THEME.background);
	});
});

describe("buildEmbedCss — 响应式", () => {
	it("lets both toolbar levels wrap, not just the outer one", () => {
		// 只放开 .top-bar 不够：最宽的一簇在 .tb-controls 里，它自己也得能换行，
		// 否则 340px 视口下仍会溢出 110px。
		const css = buildEmbedCss(THEME);
		const rule = css.match(/\.top-bar,\n\.tb-controls \{([^}]*)\}/);
		expect(rule?.[1]).toContain("flex-wrap: wrap !important");
		expect(rule?.[1]).toContain("min-width: 0 !important");
	});

	it("relaxes min-width down the chain so min-content cannot force horizontal scroll", () => {
		expect(buildEmbedCss(THEME)).toMatch(/\.device-column,\n\.dual-pane \{ min-width: 0 !important; \}/);
	});

	it("collapses the rails and the back link at their own thresholds", () => {
		// 两者宽度不同（44px vs 105px），收起的时机也不该相同。
		expect(RAILS_MAX_WIDTH_PX).toBeGreaterThan(BACK_LINK_MAX_WIDTH_PX);
		const css = buildEmbedCss(THEME);
		expect(mediaBlock(css, RAILS_MAX_WIDTH_PX)).toContain("#nativeRightRails");
		expect(mediaBlock(css, BACK_LINK_MAX_WIDTH_PX)).toContain("#nativeBackLink");
	});

	it("hides those two only inside media queries so they return when the panel is widened", () => {
		const css = buildEmbedCss(THEME);
		const withoutMedia = css.replace(/@media[\s\S]*?\n\}/g, "");
		expect(withoutMedia).not.toContain("#nativeRightRails");
		expect(withoutMedia).not.toContain("#nativeBackLink");
	});

	it("hides the dual-pane scrollbars without disabling scrolling", () => {
		// 只改滚动条外观，不动 overflow——改成 hidden 会把内容裁掉。
		const css = buildEmbedCss(THEME);
		expect(css).toContain("scrollbar-width: none");
		expect(css).toContain(".dual-pane::-webkit-scrollbar");
		expect(css).not.toContain("overflow");
	});
});
