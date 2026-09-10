// @vitest-environment jsdom
/**
 * 星轨球的主题契约：浅色模式整体换成蓝球白纹，且三态一致（hover 不该跳回深色那套）；
 * 深色模式一律用着色器自带的预设，一个参数、一个颜色都不覆盖。
 */
import { resolvedThemeAtom } from "@shared/store/atoms";
import { render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./shdr-25", () => ({
	Shdr25: ({
		statePresets,
		stateColors,
	}: {
		statePresets?: Record<string, Record<string, number>>;
		stateColors?: Record<string, Record<string, string>>;
	}) => (
		<div
			data-testid="orb"
			data-presets={statePresets === undefined ? "" : JSON.stringify(statePresets)}
			data-colors={stateColors === undefined ? "" : JSON.stringify(stateColors)}
		/>
	),
}));

import { OrbitOrb } from "./OrbitOrb";

const store = getDefaultStore();
const STATES = ["idle", "thinking", "speaking"];

afterEach(() => {
	store.set(resolvedThemeAtom, "dark");
});

describe("OrbitOrb", () => {
	it("浅色模式三态都换成蓝球白纹", () => {
		store.set(resolvedThemeAtom, "light");
		render(<OrbitOrb size={96} />);

		const orb = screen.getByTestId("orb");
		const colors = JSON.parse(orb.dataset.colors ?? "{}");
		const presets = JSON.parse(orb.dataset.presets ?? "{}");
		for (const state of STATES) {
			// 球体是蓝的、折痕是白的，这就是「蓝球白纹」的全部含义。
			expect(colors[state]).toMatchObject({ body: "#1f4bb0", tint: "#ffffff" });
			// 彩边压掉，且白纹只留最陡的棱——铺满的话球在白底上没有轮廓。
			expect(presets[state]).toMatchObject({ fringe: 0.02, saturation: 1, floorLevel: 1.6 });
		}
	});

	it("深色模式不覆盖着色器自带的预设与配色", () => {
		store.set(resolvedThemeAtom, "dark");
		render(<OrbitOrb size={96} />);

		const orb = screen.getByTestId("orb");
		expect(orb.dataset.presets).toBe("");
		expect(orb.dataset.colors).toBe("");
	});
});
