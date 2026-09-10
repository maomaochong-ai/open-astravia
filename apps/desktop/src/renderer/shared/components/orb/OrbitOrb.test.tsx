// @vitest-environment jsdom
/**
 * 星轨球的主题契约：浅色模式整体换成白球蓝纹，且三态一致（hover 不该跳回深色那套）；
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
	it("浅色模式三态都换成白球蓝纹", () => {
		store.set(resolvedThemeAtom, "light");
		render(<OrbitOrb size={96} />);

		const orb = screen.getByTestId("orb");
		const colors = JSON.parse(orb.dataset.colors ?? "{}");
		const presets = JSON.parse(orb.dataset.presets ?? "{}");
		for (const state of STATES) {
			// 反相之后 `tint` 是球体、`body` 是折痕：白球蓝纹。
			expect(colors[state]).toMatchObject({ body: "#86a9ee", tint: "#c3d0e2" });
			// 反相必须三态都开，否则平面与折痕的白蓝分工会整个对调。
			expect(presets[state]).toMatchObject({ invert: 1, fringe: 0.02, saturation: 1 });
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
