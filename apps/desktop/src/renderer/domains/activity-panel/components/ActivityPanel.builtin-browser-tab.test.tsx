// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	attachedPluginTabsAtom,
} from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { ActivityPanel } from "./ActivityPanel";

// t 直接回显键名，断言就能盯住 key 本身而不是某一条译文。
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("motion/react", () => {
	const motion = new Proxy(
		{},
		{
			get:
				() =>
				({ children }: { children: ReactNode }) => <div>{children}</div>,
		},
	);
	return {
		AnimatePresence: ({ children }: { children: ReactNode }) => children,
		LayoutGroup: ({ children }: { children: ReactNode }) => children,
		motion,
		useReducedMotion: () => true,
	};
});

// The file tab owns a live fs watcher; this suite only cares about tab resolution.
vi.mock("./file-tab/FileTabContent", () => ({
	FileTabContent: () => <div>file body</div>,
}));

// <webview> 在 jsdom 里不存在，浏览器面板的 IPC/webview 装配不是本用例的目标。
vi.mock("./BrowserPanel", () => ({
	BrowserPanel: () => <div>browser body</div>,
}));

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const workspace = createActivityWorkspace("/tmp/builtin-tab-workspace", "/tmp/builtin-tab-workspace", []);

function renderPanel() {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	render(
		<Provider store={store}>
			<ActivityPanel workspace={workspace} pluginScenario="conversation" />
		</Provider>,
	);
	return store;
}

function openTabPicker(): void {
	const trigger = screen.getByTitle("tabPicker.menu");
	fireEvent.click(trigger);
}

describe("activity panel builtin browser tab", () => {
	it("keeps the browser off the bar until the user adds it from the tab menu", () => {
		renderPanel();

		expect(screen.queryByText("browser.tab")).toBeNull();
		expect(screen.queryByText("browser body")).toBeNull();

		openTabPicker();
		expect(screen.queryByText("tabPicker.availablePanels")).not.toBeNull();
		expect(screen.queryByText("browser.tab")).not.toBeNull();
	});

	it("attaches and opens the browser when its menu entry is clicked", async () => {
		const store = renderPanel();
		openTabPicker();

		await act(async () => {
			fireEvent.click(screen.getByText("browser.tab"));
		});

		expect(store.get(attachedPluginTabsAtom).get(workspace.id)).toEqual(["browser"]);
		expect(store.get(activityPanelTabByProjectAtom).get(workspace.id)).toBe("browser");
		expect(await screen.findByText("browser body")).not.toBeNull();
	});

	it("does not offer the browser again once it is on the bar", () => {
		const store = createStore();
		store.set(activityPanelOpenAtom, true);
		store.set(attachedPluginTabsAtom, new Map([[workspace.id, ["browser"]]]));
		render(
			<Provider store={store}>
				<ActivityPanel workspace={workspace} pluginScenario="conversation" />
			</Provider>,
		);

		expect(screen.queryByText("browser.tab")).not.toBeNull();
		openTabPicker();
		expect(screen.queryByText("tabPicker.availablePanels")).toBeNull();
	});
});
