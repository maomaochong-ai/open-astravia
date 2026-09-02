import { describe, expect, it } from "vitest";
import {
	BACK_LINK_MAX_WIDTH_PX,
	buildEmbedCss,
	CAPTURE_SIZE_MAX_WIDTH_PX,
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

/** 断言只针对真实规则，注释里提到某个选择器不算数。 */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function mediaBlock(css: string, maxWidth: number): string {
	const match = css.match(new RegExp(`@media \\(max-width: ${maxWidth}px\\) \\{([\\s\\S]*?)\\n\\}`));
	return match?.[1] ?? "";
}

describe("buildEmbedCss — 配色", () => {
	it("remaps the --nv-* surface tokens so every glass surface follows the host", () => {
		// 顶栏、左右下角浮动按钮、各种 rail 与 sheet、下拉浮层共用这套变量。
		// 改这里等于一次覆盖全部，不必逐个选择器写死颜色。
		const rule = buildEmbedCss(THEME).match(/#simNativeView \{([^}]*)\}/);
		expect(rule?.[1]).toContain(`--nv-bar-bg: ${THEME.card} !important`);
		expect(rule?.[1]).toContain(`--nv-text: ${THEME.foreground} !important`);
		expect(rule?.[1]).toContain(`--nv-page-bg: ${THEME.background} !important`);
		expect(rule?.[1]).toContain(`--nv-accent: ${THEME.accent} !important`);
	});

	it("marks every :root token important, because the page re-injects its own", () => {
		// 页面在运行时会再注入一份 :root，排在注入的样式表之后。少一条 !important，
		// 那条就会被盖回浅色——侧栏视图整片白就是这么来的。
		const block = buildEmbedCss(THEME).match(/:root \{([^}]*)\}/)?.[1] ?? "";
		const declarations = block.split("\n").filter((line) => line.trim().length > 0);
		expect(declarations.length).toBeGreaterThan(5);
		for (const line of declarations) expect(line).toContain("!important");
		expect(block).toContain(`--panel: ${THEME.card}`);
	});

	it("covers the sidebar view surfaces that hardcode light literals", () => {
		// 这些不走任何变量，只能按选择器覆盖；.btn-primary 不在其中，强调色要保留。
		const css = stripComments(buildEmbedCss(THEME));
		for (const selector of [".card-header", "summary", ".btn-secondary", "#simStreamFps", ".sim-tip"]) {
			expect(css).toContain(selector);
		}
		expect(css).not.toContain(".btn-primary");
	});

	it("hides baguette's own theme toggle, which the host palette makes inert", () => {
		expect(buildEmbedCss(THEME)).toContain("#nativeThemeToggle { display: none !important; }");
	});

	it("keeps the scrim readable in both modes", () => {
		expect(buildEmbedCss(THEME)).toContain("rgba(0, 0, 0, 0.55)");
		expect(buildEmbedCss({ ...THEME, dark: false })).toContain("rgba(15, 23, 42, 0.32)");
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
	it("never overrides the toolbar's own layout or overflow", () => {
		// 两次都栽在这上面，所以用断言钉死：
		// - flex-wrap: wrap → 换行的第二三行甩到设备画面上，且让 ToolbarFold 的
		//   scrollWidth > clientWidth 判定永远不成立，把所有控件展开。
		// - overflow-x: auto → 建立裁剪上下文，折叠菜单的下拉浮层被整个裁掉。
		// 实测只要收起 capture-size，它自带的折叠在 260px 起都能把内容压进胶囊。
		const css = buildEmbedCss(THEME);
		const topBarRules = css.match(/\.top-bar[^{]*\{[^}]*\}/g) ?? [];
		expect(topBarRules.length).toBeGreaterThan(0);
		for (const rule of topBarRules) {
			expect(rule).not.toContain("flex-wrap");
			expect(rule).not.toContain("overflow");
		}
	});

	it("re-anchors the fold popovers to the centred toolbar so they cannot be clipped", () => {
		// 浮层原本以 38px 的触发器为基准并带 translateX(-50%)，窄面板下向左展开会伸出视口。
		// 换成以 .top-bar 为包含块（把 .tb-fold 置为 static）后与工具栏同宽；那个 transform
		// 必须一并中和，否则会把浮层推偏半个工具栏宽度。
		const css = buildEmbedCss(THEME);
		expect(css).toMatch(/\.tb-fold \{ position: static !important; \}/);
		const rule = css.match(/\.tb-fold-pop \{([^}]*)\}/);
		expect(rule?.[1]).toContain("left: 0 !important");
		expect(rule?.[1]).toContain("right: 0 !important");
		expect(rule?.[1]).toContain("transform: none !important");
	});

	it("leaves the popover's own vertical offset alone", () => {
		// 它的 top: calc(100% + 8px) 换基准后正好落在工具栏下方，不需要也不应该覆盖。
		const rule = buildEmbedCss(THEME).match(/\.tb-fold-pop \{([^}]*)\}/);
		expect(rule?.[1]).not.toContain("top:");
		expect(rule?.[1]).not.toContain("bottom:");
	});

	it("relaxes min-width down the chain so min-content cannot force horizontal scroll", () => {
		expect(buildEmbedCss(THEME)).toMatch(/\.device-column,\n\.dual-pane \{ min-width: 0 !important; \}/);
	});

	it("collapses each element at its own threshold, widest first", () => {
		// 三者占宽不同（44px / 105px / 154px），收起时机也不该相同。
		expect(RAILS_MAX_WIDTH_PX).toBeGreaterThan(BACK_LINK_MAX_WIDTH_PX);
		expect(BACK_LINK_MAX_WIDTH_PX).toBeGreaterThan(CAPTURE_SIZE_MAX_WIDTH_PX);
		const css = buildEmbedCss(THEME);
		expect(mediaBlock(css, RAILS_MAX_WIDTH_PX)).toContain("#nativeRightRails");
		expect(mediaBlock(css, BACK_LINK_MAX_WIDTH_PX)).toContain("#nativeBackLink");
		expect(mediaBlock(css, CAPTURE_SIZE_MAX_WIDTH_PX)).toContain(".cap-size-code");
	});

	it("drops the rails gutter in the same breakpoint that hides the rails", () => {
		// .dual-pane 的 58px 右 padding 是给工具条留的位置。只隐藏工具条不去掉留白，
		// 设备就会左偏 29px；反过来工具条可见时这段留白是对的，不能无条件去掉。
		const css = buildEmbedCss(THEME);
		const block = mediaBlock(css, RAILS_MAX_WIDTH_PX);
		expect(block).toContain("padding-right: 0 !important");
		const withoutMedia = css.replace(/@media[\s\S]*?\n\}/g, "");
		expect(withoutMedia).not.toContain("padding-right");
	});

	it("hides those two only inside media queries so they return when the panel is widened", () => {
		const css = buildEmbedCss(THEME);
		const withoutMedia = css.replace(/@media[\s\S]*?\n\}/g, "");
		expect(withoutMedia).not.toContain("#nativeRightRails");
		expect(withoutMedia).not.toContain("#nativeBackLink");
		expect(withoutMedia).not.toContain(".cap-size-code");
	});

	it("hides the dual-pane scrollbars without touching its overflow", () => {
		// 只改滚动条外观。给 .dual-pane 设 overflow 会把设备画面裁掉——顶栏那条
		// overflow-x 是另一回事，只作用在胶囊自己身上。
		const css = buildEmbedCss(THEME);
		expect(css).toContain(".dual-pane::-webkit-scrollbar");
		const dualPaneRules = css.match(/\.dual-pane[^{]*\{[^}]*\}/g) ?? [];
		expect(dualPaneRules.length).toBeGreaterThan(0);
		for (const rule of dualPaneRules) expect(rule).not.toContain("overflow");
	});
});
