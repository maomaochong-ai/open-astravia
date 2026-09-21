// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@shared/i18n", () => ({
	i18n: { t: (key: string) => key },
}));

const { useTheme, useThemeActions } = await import("./useTheme.js");
const { ThemeController } = await import("../theme/ThemeController.js");

function installThemeApi(setNativeTheme: ReturnType<typeof vi.fn>): void {
	const subscribe = vi.fn(() => vi.fn());
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			theme: {
				set: setNativeTheme,
				getNative: vi.fn(async () => ({ source: "dark", shouldUseDarkColors: true })),
				onNativeChanged: subscribe,
				onModeRequested: subscribe,
				onChangeRequested: subscribe,
				onStateRequested: subscribe,
				onHelpRequested: subscribe,
			},
		},
	});
}

function ModeHarness(): JSX.Element {
	const { mode, setMode } = useTheme();
	return <button onClick={() => void setMode("light")}>{mode}</button>;
}

describe("useTheme", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("class");
		document.documentElement.removeAttribute("data-mode");
		document.documentElement.removeAttribute("data-theme");
		document.documentElement.removeAttribute("data-theme-transition");
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
		});
		Object.defineProperty(document, "startViewTransition", {
			configurable: true,
			value: (update: () => void) => {
				update();
				return { ready: Promise.resolve(), finished: Promise.resolve() };
			},
		});
		Object.defineProperty(document.documentElement, "animate", {
			configurable: true,
			value: vi.fn(() => ({}) as Animation),
		});
	});

	it("用户切换明暗模式时先更新页面，再异步同步原生窗口主题", () => {
		let finishNativeSync: (() => void) | undefined;
		const setNativeTheme = vi.fn(
			(mode: string) =>
				mode === "light"
					? new Promise<void>((resolve) => {
							finishNativeSync = resolve;
						})
					: Promise.resolve(),
		);
		installThemeApi(setNativeTheme);

		render(
			<Provider store={createStore()}>
				<ThemeController />
				<ModeHarness />
			</Provider>,
		);
		setNativeTheme.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "dark" }));

		expect(screen.getByRole("button", { name: "light" })).toBeTruthy();
		expect(document.documentElement.getAttribute("data-mode")).toBe("light");
		expect(setNativeTheme).toHaveBeenCalledWith("light");
		expect(finishNativeSync).toBeTypeOf("function");
	});

	it("只使用主题写操作的组件不会订阅主题状态", () => {
		installThemeApi(vi.fn(async () => {}));
		const actionOnlyRender = vi.fn();

		function ActionOnly(): null {
			useThemeActions();
			actionOnlyRender();
			return null;
		}

		function ThemeNameHarness(): JSX.Element {
			const { themeName, setThemeName } = useTheme();
			return <button onClick={() => setThemeName("sand")}>{themeName}</button>;
		}

		render(
			<Provider store={createStore()}>
				<ActionOnly />
				<ThemeNameHarness />
			</Provider>,
		);

		fireEvent.click(screen.getByRole("button"));

		expect(screen.getByRole("button", { name: "sand" })).toBeTruthy();
		expect(actionOnlyRender).toHaveBeenCalledTimes(1);
	});
});
