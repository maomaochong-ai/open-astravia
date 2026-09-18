// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TabModule = { default: ComponentType };

const tabLoad = vi.hoisted(() => {
	const pending = new Map<string, Promise<TabModule>>();
	const resolvers = new Map<string, (value: TabModule) => void>();
	const loaders = new Map<string, () => Promise<TabModule>>();

	function reset(): void {
		pending.clear();
		resolvers.clear();
		loaders.clear();
	}

	function loaderFor(tab: string): () => Promise<TabModule> {
		let loader = loaders.get(tab);
		if (!loader) {
			loader = () => {
				let promise = pending.get(tab);
				if (!promise) {
					promise = new Promise<TabModule>((resolve) => {
						resolvers.set(tab, resolve);
					});
					pending.set(tab, promise);
				}
				return promise;
			};
			loaders.set(tab, loader);
		}
		return loader;
	}

	return {
		reset,
		loaderFor,
		resolve(tab: string, Content: ComponentType): void {
			resolvers.get(tab)?.({ default: Content });
		},
		started(tab: string): boolean {
			return pending.has(tab);
		},
	};
});

vi.mock("./settings-tab-loaders", () => ({
	SETTINGS_TAB_LOADERS: new Proxy(
		{},
		{
			get: (_target, tab: string) => tabLoad.loaderFor(tab),
		},
	),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

const { SettingsTabSurfaces } = await import("./SettingsTabSurfaces.js");

function visibleHeading(container: HTMLElement): HTMLElement | undefined {
	return [...container.querySelectorAll("h1")].find((node) => node.closest("[hidden]") === null);
}

function paragraph(container: HTMLElement, text: string): HTMLElement | undefined {
	return [...container.querySelectorAll("p")].find((node) => node.textContent === text);
}

describe("SettingsTabSurfaces", () => {
	beforeEach(() => {
		tabLoad.reset();
	});

	it("切到尚未访问的设置标签时先画出标签名，chunk 未到也不铺脉冲骨架", async () => {
		const { container, rerender } = render(<SettingsTabSurfaces activeTab="general" />);
		expect(visibleHeading(container)?.textContent).toBe("tabGeneral");
		expect(container.textContent).not.toContain("general-body");
		expect(container.querySelector(".animate-pulse")).toBeNull();

		await act(async () => {
			tabLoad.resolve("general", () => <p>general-body</p>);
		});
		await waitFor(() => {
			expect(container.textContent).toContain("general-body");
		});
		const general = paragraph(container, "general-body");
		expect(general).toBeTruthy();

		rerender(<SettingsTabSurfaces activeTab="models" />);
		expect(visibleHeading(container)?.textContent).toBe("tabModels");
		expect(container.textContent).not.toContain("models-body");
		expect(container.querySelector(".animate-pulse")).toBeNull();
		expect(paragraph(container, "general-body")).toBe(general);
		expect(general?.closest("[hidden]")).not.toBeNull();
		expect(tabLoad.started("models")).toBe(true);

		rerender(<SettingsTabSurfaces activeTab="appearance" />);
		expect(visibleHeading(container)?.textContent).toBe("tabAppearance");
		expect(container.textContent).not.toContain("models-body");
		expect(tabLoad.started("models")).toBe(true);

		await act(async () => {
			tabLoad.resolve("models", () => <p>models-body</p>);
		});
		const models = paragraph(container, "models-body");
		expect(models).toBeTruthy();
		expect(models?.closest("[hidden]")).not.toBeNull();

		rerender(<SettingsTabSurfaces activeTab="models" />);
		expect(paragraph(container, "models-body")).toBe(models);
		expect(models?.closest("[hidden]")).toBeNull();
		expect(general?.closest("[hidden]")).not.toBeNull();
	});
});
