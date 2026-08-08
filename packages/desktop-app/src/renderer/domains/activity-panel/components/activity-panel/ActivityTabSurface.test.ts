// @vitest-environment jsdom

import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityTabActivation } from "../../registry/activation-context";
import type { ActivityTabDefinition, ResolvedActivityTab } from "../../registry/types";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";
import { ActivityTabSurface } from "./ActivityTabSurface";
import type { ActivityPanelActions } from "./types";

vi.mock("motion/react", () => ({ motion: { span: () => null } }));

function frame({ children }: ActivityPanelFrameProps): ReturnType<typeof createElement> {
	return createElement("div", { "data-frame": "" }, children as ReactNode);
}

function actions(): ActivityPanelActions {
	return {
		onAttachPluginTab: vi.fn(),
		onClose: vi.fn(),
		onFloatingResize: vi.fn(),
		onFloatingResizeEnd: vi.fn(),
		onFloatingTabDragEnd: vi.fn(),
		onFloatingTabDragMove: vi.fn(),
		onFloatingTabDragStart: vi.fn(),
		onFloatingTabFocus: vi.fn(),
		onOverflowChange: vi.fn(),
		onRemoveTab: vi.fn(),
		onReorderTabs: vi.fn(),
		onResize: vi.fn(),
		onResizeEnd: vi.fn(),
		onRestoreTab: vi.fn(),
		onTabChange: vi.fn(),
		onTabDragEnd: vi.fn(),
		onTabDragMove: vi.fn(),
		onTabDragStart: vi.fn(),
	};
}

describe("ActivityTabSurface", () => {
	let container: HTMLDivElement;
	let dockedOutlet: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		dockedOutlet = document.createElement("div");
		document.body.append(container, dockedOutlet);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		dockedOutlet.remove();
	});

	it("keeps the content instance mounted while moving out and back", () => {
		let mounts = 0;
		let unmounts = 0;
		function Content(): ReturnType<typeof createElement> {
			useEffect(() => {
				mounts += 1;
				return () => {
					unmounts += 1;
				};
			}, []);
			return createElement("div", { "data-content-instance": "" });
		}
		const definition: ActivityTabDefinition = {
			id: "file",
			source: "builtin",
			useMeta: () => ({ label: "A" }),
			component: Content,
		};
		const tab: ResolvedActivityTab = {
			id: "file",
			label: "A",
			icon: createElement("span", { "data-custom-tab-icon": "" }),
			removable: false,
			source: "builtin",
			definition,
		};
		const surfaceActions = actions();
		const shared = {
			actions: surfaceActions,
			dockedOutlet,
			Frame: frame,
			removeLabel: "Hide tab",
			tab,
		};

		act(() => {
			root.render(
				createElement(ActivityTabSurface, {
					...shared,
					floating: null,
					isActiveDocked: true,
				}),
			);
		});
		const content = dockedOutlet.querySelector("[data-content-instance]");
		expect(content).not.toBeNull();
		expect(mounts).toBe(1);

		act(() => {
			root.render(
				createElement(ActivityTabSurface, {
					...shared,
					floating: { key: "file", x: 100, y: 80, width: 360, height: 420, zIndex: 1 },
					isActiveDocked: false,
				}),
			);
		});
		const floatingPanel = container.querySelector("[data-floating-activity-tab]");
		expect(floatingPanel?.querySelector("[data-content-instance]")).toBe(content);
		expect(floatingPanel?.querySelector("[data-custom-tab-icon]")).not.toBeNull();
		act(() => content?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
		expect(surfaceActions.onFloatingTabFocus).toHaveBeenCalledWith("file");
		expect(mounts).toBe(1);
		expect(unmounts).toBe(0);

		act(() => {
			root.render(
				createElement(ActivityTabSurface, {
					...shared,
					floating: null,
					isActiveDocked: true,
				}),
			);
		});
		expect(dockedOutlet.querySelector("[data-content-instance]")).toBe(content);
		expect(mounts).toBe(1);
		expect(unmounts).toBe(0);
	});

	it("updates activation state without remounting kept content", () => {
		let mounts = 0;
		let unmounts = 0;
		function Content(): ReturnType<typeof createElement> {
			const active = useActivityTabActivation();
			useEffect(() => {
				mounts += 1;
				return () => {
					unmounts += 1;
				};
			}, []);
			return createElement("div", { "data-active": String(active) });
		}
		const definition: ActivityTabDefinition = {
			id: "plugin:remotion-renderer:studio",
			source: "plugin",
			useMeta: () => ({ label: "Studio" }),
			component: Content,
			keepAliveWhenAvailable: true,
		};
		const tab: ResolvedActivityTab = {
			id: definition.id,
			label: "Studio",
			removable: true,
			source: "plugin",
			definition,
		};
		const shared = {
			actions: actions(),
			dockedOutlet,
			Frame: frame,
			floating: null,
			removeLabel: "Hide tab",
			tab,
		};

		act(() => {
			root.render(createElement(ActivityTabSurface, { ...shared, isActiveDocked: true }));
		});
		const content = dockedOutlet.querySelector("[data-active]");
		expect(content?.getAttribute("data-active")).toBe("true");

		act(() => {
			root.render(createElement(ActivityTabSurface, { ...shared, isActiveDocked: false }));
		});
		expect(dockedOutlet.querySelector("[data-active]")).toBe(content);
		expect(content?.getAttribute("data-active")).toBe("false");
		expect(mounts).toBe(1);
		expect(unmounts).toBe(0);
	});
});
