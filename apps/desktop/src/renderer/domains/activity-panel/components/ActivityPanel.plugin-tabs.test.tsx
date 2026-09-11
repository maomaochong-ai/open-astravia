// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityPanelOpenAtom, pluginActivityTabsAtom, type RegisteredActivityTab } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { ActivityPanel } from "./ActivityPanel";

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

function pluginTab(): RegisteredActivityTab {
	return {
		pluginId: "demo",
		pluginName: "Demo",
		tabId: "panel",
		label: "Demo panel",
		component: () => <div>demo body</div>,
		scope_use: ["conversation"],
	};
}

function renderPanel(scenario: "conversation" | undefined): void {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	store.set(pluginActivityTabsAtom, [pluginTab()]);
	render(
		<Provider store={store}>
			<ActivityPanel
				workspace={createActivityWorkspace("agent-team:workspace", "/tmp/team-cwd", ["member-runtime"])}
				{...(scenario ? { pluginScenario: scenario } : {})}
			/>
		</Provider>,
	);
}

describe("activity panel plugin tabs outside the ordinary conversation host", () => {
	// A Team session never drives the global scenario atom, so the host must hand the
	// panel its own scenario; without it plugin contributions fail closed and the bar
	// collapses to the builtin tabs only.
	it("puts a registered plugin tab on the bar when the host supplies its scenario", () => {
		renderPanel("conversation");
		expect(screen.queryByText("Demo panel")).not.toBeNull();
	});

	it("keeps plugin tabs off the bar when the host supplies no scenario", () => {
		renderPanel(undefined);
		expect(screen.queryByText("Demo panel")).toBeNull();
	});
});
