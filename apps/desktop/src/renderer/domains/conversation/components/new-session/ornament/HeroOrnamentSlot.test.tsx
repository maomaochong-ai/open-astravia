// @vitest-environment jsdom
/**
 * 装饰件位按「设置 - 外观 - 装饰件」的选择决定挂谁：
 * 选「无」时这块位置一个节点都不该留，选 Vivi（含未选过、存了脏值）时挂上 Vivi，
 * 选星轨/火把/马里奥/燃烧/玩手/能源井时挂上对应的那枚。
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./presets/BlazeOrnament", () => ({
	BlazeOrnament: () => <div data-testid="blaze" />,
}));

vi.mock("./presets/EnergyWellOrnament", () => ({
	EnergyWellOrnament: () => <div data-testid="well" />,
}));

vi.mock("./presets/HandOrnament", () => ({
	HandOrnament: () => <div data-testid="hand" />,
}));

vi.mock("./presets/MarioOrnament", () => ({
	MarioOrnament: () => <div data-testid="mario" />,
}));

vi.mock("./presets/OrbitOrnament", () => ({
	OrbitOrnament: () => <div data-testid="orbit" />,
}));

vi.mock("./presets/TorchOrnament", () => ({
	TorchOrnament: () => <div data-testid="torch" />,
}));

vi.mock("./presets/ViviOrnament", () => ({
	ViviOrnament: () => <div data-testid="vivi" />,
}));

const STORAGE_KEY = "vetta-hero-ornament";

/** atom 的初值在模块加载时就从 localStorage 读走了，所以每次都要先写值再重新 import。 */
async function renderSlot(stored: string | null): Promise<void> {
	if (stored === null) window.localStorage.removeItem(STORAGE_KEY);
	else window.localStorage.setItem(STORAGE_KEY, stored);
	vi.resetModules();
	const { HeroOrnamentSlot } = await import("./HeroOrnamentSlot");
	render(<HeroOrnamentSlot autoplay={false} mounted />);
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.resetModules();
});

describe("HeroOrnamentSlot", () => {
	it("未选过时挂上默认的 Vivi", async () => {
		await renderSlot(null);

		expect(screen.getByTestId("vivi")).toBeTruthy();
	});

	it("选「无」时不渲染任何装饰件", async () => {
		await renderSlot("none");

		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选星轨时挂上星轨", async () => {
		await renderSlot("orbit");

		expect(screen.getByTestId("orbit")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选火把时挂上火把", async () => {
		await renderSlot("torch");

		expect(screen.getByTestId("torch")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选马里奥时挂上马里奥", async () => {
		await renderSlot("mario");

		expect(screen.getByTestId("mario")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选燃烧时挂上燃烧", async () => {
		await renderSlot("blaze");

		expect(screen.getByTestId("blaze")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选玩手时挂上玩手", async () => {
		await renderSlot("hand");

		expect(screen.getByTestId("hand")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("选能源井时挂上能源井", async () => {
		await renderSlot("well");

		expect(screen.getByTestId("well")).toBeTruthy();
		expect(screen.queryByTestId("vivi")).toBeNull();
	});

	it("存了未知装饰件时回落到默认的 Vivi", async () => {
		await renderSlot("not-an-ornament");

		expect(screen.getByTestId("vivi")).toBeTruthy();
	});
});
