import type { ThemeColorTokens } from "@astravia-org/theme-sdk/appearance";
import { describe, expect, it } from "vitest";
import type { ThemeDef } from "../tokens.js";
import { beeTheme } from "./bee.js";
import { forestTheme } from "./forest.js";
import { mintTheme } from "./mint.js";
import { parchmentTheme } from "./parchment.js";

/**
 * 四套彩色主题的色板守卫。
 *
 * 这里钉的不是「颜色好不好看」，而是三条会让主题彻底失效的硬约束：
 * 1. 表面必须分层——画布、卡面、muted、secondary 一旦都取纯白，切主题时除按钮之外
 *    界面毫无变化（这正是这套主题最初的缺陷）。
 * 2. 文字必须在自己的背景上可读。
 * 3. 图表色必须是主题自己的颜色，否则同一套模板画出来四张图长得一样。
 */

const THEMES: ThemeDef[] = [forestTheme, beeTheme, mintTheme, parchmentTheme];

function channels(value: string): [number, number, number] {
	const match = value.match(/^#([0-9a-f]{6})$/i);
	if (!match) throw new Error(`主题色必须是 #rrggbb 字面量，收到 ${value}`);
	const hex = match[1];
	return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(value: string): number {
	const [r, g, b] = channels(value).map((channel) => {
		const unit = channel / 255;
		return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
	return (high + 0.05) / (low + 0.05);
}

function distance(a: string, b: string): number {
	const [ar, ag, ab] = channels(a);
	const [br, bg, bb] = channels(b);
	return Math.hypot(ar - br, ag - bg, ab - bb);
}

describe.each(THEMES)("$id 主题色板", (theme) => {
	it("浅色的表面自 secondary 向 card 逐级提亮", () => {
		const steps = [theme.light.secondary, theme.light.muted, theme.light.background, theme.light.card];
		const ladders = steps.map(luminance);
		for (let index = 1; index < ladders.length; index += 1) {
			expect(ladders[index], `${steps[index - 1]} → ${steps[index]} 没有更亮`).toBeGreaterThan(ladders[index - 1]);
		}
		// 单调还不够：相邻两层差得太少时肉眼读不出层次，卡片会融进画布。
		for (let index = 1; index < steps.length; index += 1) {
			expect(distance(steps[index - 1], steps[index])).toBeGreaterThanOrEqual(6);
		}
	});

	it("深色的表面自画布向 secondary 逐级提亮", () => {
		const steps = [theme.dark.background, theme.dark.muted, theme.dark.card, theme.dark.secondary];
		const ladders = steps.map(luminance);
		for (let index = 1; index < ladders.length; index += 1) {
			expect(ladders[index], `${steps[index - 1]} → ${steps[index]} 没有更亮`).toBeGreaterThan(ladders[index - 1]);
		}
		for (let index = 1; index < steps.length; index += 1) {
			expect(distance(steps[index - 1], steps[index])).toBeGreaterThanOrEqual(6);
		}
	});

	it("浅色与深色的表面不是同一层阶梯", () => {
		expect(distance(theme.light.background, theme.dark.background)).toBeGreaterThan(120);
	});

	const readable: ReadonlyArray<[keyof ThemeColorTokens, keyof ThemeColorTokens, number]> = [
		["foreground", "background", 7],
		["foreground", "card", 7],
		["mutedForeground", "background", 4.5],
		// 侧栏文字落在 muted 上，这一组最容易在彩色主题里翻车。
		["mutedForeground", "muted", 4.5],
		["primaryForeground", "primary", 4.5],
		["primary", "background", 3],
	];

	it.each(readable)("%s 在 %s 上的对比度不低于 %s", (text, surface, minimum) => {
		expect(contrast(theme.light[text], theme.light[surface])).toBeGreaterThanOrEqual(minimum);
		expect(contrast(theme.dark[text], theme.dark[surface])).toBeGreaterThanOrEqual(minimum);
	});

	it("图表色是主题自己的颜色，且两两可分辨", () => {
		const light = [
			theme.light.chart1,
			theme.light.chart2,
			theme.light.chart3,
			theme.light.chart4,
			theme.light.chart5,
		];
		const dark = [theme.dark.chart1, theme.dark.chart2, theme.dark.chart3, theme.dark.chart4, theme.dark.chart5];

		for (let index = 0; index < light.length; index += 1) {
			for (let other = index + 1; other < light.length; other += 1) {
				expect(distance(light[index], light[other]), `chart${index + 1}/${other + 1} 太接近`).toBeGreaterThan(20);
				expect(distance(dark[index], dark[other]), `深色 chart${index + 1}/${other + 1} 太接近`).toBeGreaterThan(
					20,
				);
			}
		}
	});

	it("主题选择器的预览色随主题变化", () => {
		// 预览取深色模式的 primary / accent / ring / chart1 / chart2。它们曾经全部继承
		// default，于是四套主题在列表里长得一模一样，切过去才发现变了。
		const preview = (item: ThemeDef) =>
			[item.dark.primary, item.dark.accent, item.dark.ring, item.dark.chart1, item.dark.chart2].join(",");
		expect(new Set(THEMES.map(preview)).size).toBe(THEMES.length);
	});
});

/**
 * 主题之间的可分辨性：允许「有点像」，不允许「看起来是同一套」。
 *
 * 深色下四套主题的画布曾经都挤在 #0a120e–#14100c 之间（森林↔薄荷 RGB 距离 4.7，
 * 蜜蜂↔羊皮纸 4.6），浅色下蜜蜂↔羊皮纸只剩 3.7。那种情况下切主题只看到按钮变色，
 * 画布和侧栏读不出一丝差别——用户的原话是「四套主题颜色几乎无差异」。
 */
describe("四套主题彼此可分辨", () => {
	function assertApart(pick: (theme: ThemeDef) => string, minimum: number, label: string): void {
		for (let index = 0; index < THEMES.length; index += 1) {
			for (let other = index + 1; other < THEMES.length; other += 1) {
				const left = THEMES[index];
				const right = THEMES[other];
				expect(
					distance(pick(left), pick(right)),
					`${label}：${left.id} / ${right.id} 太接近`,
				).toBeGreaterThanOrEqual(minimum);
			}
		}
	}

	it("深色画布两两可分辨", () => {
		assertApart((theme) => theme.dark.background, 6, "深色画布");
	});

	it("浅色画布两两可分辨", () => {
		assertApart((theme) => theme.light.background, 8, "浅色画布");
	});

	it("森林偏橄榄、薄荷偏青，两套绿色主题不共用色相", () => {
		// 往同一个色相偏也能过「距离」守卫（各自压暗一点就分开了），但用户会把两套
		// 主题读成同一套的深浅版。这里钉住色相方向：森林绿高于蓝（橄榄），薄荷蓝高于绿（青）。
		const [, forestGreen, forestBlue] = channels(forestTheme.dark.background);
		const [, mintGreen, mintBlue] = channels(mintTheme.dark.background);
		expect(forestGreen).toBeGreaterThan(forestBlue);
		expect(mintBlue).toBeGreaterThan(mintGreen);
	});
});
