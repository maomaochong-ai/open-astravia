// @vitest-environment jsdom
/**
 * 装饰件位按「设置 - 外观 - 装饰件」的选择决定挂谁：
 * 选「无」时这块位置一个节点都不该留，选 Vivi / 马里奥时挂上对应的那枚。
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrnamentId } from "@shared/theme/ornament";
import { HeroOrnamentSlot } from "./HeroOrnamentSlot";

const useHeroOrnament = vi.hoisted(() => vi.fn());

vi.mock("@shared/hooks/useHeroOrnament", () => ({ useHeroOrnament }));

vi.mock("./presets/MarioOrnament", () => ({
	MarioOrnament: () => <div data-testid="mario" />,
}));

vi.mock("./presets/ViviOrnament", () => ({
	ViviOrnament: () => <div data-testid="vivi" />,
}));

function renderSlot(ornamentId: OrnamentId): void {
	useHeroOrnament.mockReturnValue({ ornamentId });
	render(<HeroOrnamentSlot autoplay={false} mounted />);
}

beforeEach(() => {
	useHeroOrnament.mockReset();
});

describe("HeroOrnamentSlot", () => {
	it("选「无」时不渲染任何装饰件", () => {
		renderSlot("none");

		expect(screen.queryByTestId("mario")).toBeNull();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it.each([
		["vivi", "vivi"],
		["mario", "mario"],
	] satisfies readonly (readonly [OrnamentId, string])[])("选择 %s 时渲染对应装饰件", (ornamentId, testId) => {
		renderSlot(ornamentId);

		expect(screen.getByTestId(testId)).toBeTruthy();
	});
});
