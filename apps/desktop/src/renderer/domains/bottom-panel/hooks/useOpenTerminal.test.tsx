// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	activeBottomPanelTab,
	activeInputDraftKeyAtom,
	activeSessionAtom,
	type BottomPanelAction,
	bottomPanelStateAtom,
	collectBottomPanelLeaves,
	dispatchBottomPanelAtom,
} from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { TERMINAL_PANEL_ID } from "../builtins";
import { bottomPanelFocusRequestAtom } from "../registry/instance-atoms";
import { useOpenTerminal } from "./useOpenTerminal";

const capabilities = vi.hoisted(() => ({ localPty: true }));

vi.mock("./useTerminalCapabilities", () => ({
	useTerminalCapabilities: () => capabilities,
}));

const PLUGIN_ID = "plugin:demo:logs";

function Harness(): JSX.Element {
	const terminal = useOpenTerminal();
	return (
		<button type="button" disabled={!terminal.available} aria-pressed={terminal.focused} onClick={terminal.open}>
			open-terminal
		</button>
	);
}

function setup(cwd = "/workspace", ...actions: BottomPanelAction[]) {
	const store = createStore();
	store.set(activeSessionAtom, { cwd, sessionPath: "/session.json", runtimeId: "session" });
	store.set(activeInputDraftKeyAtom, "/session.json");
	for (const action of actions) store.set(dispatchBottomPanelAtom, action);
	render(
		<Provider store={store}>
			<Harness />
		</Provider>,
	);
	const button = screen.getByRole("button", { name: "open-terminal" });
	return { store, button, click: () => userEvent.setup().click(button) };
}

function open(tabId: string, componentId: string = TERMINAL_PANEL_ID): BottomPanelAction {
	return { type: "open-tab", tabId, componentId, newLeafId: `leaf-${tabId}` };
}

function terminalTabIds(store: ReturnType<typeof createStore>): string[] {
	return collectBottomPanelLeaves(store.get(bottomPanelStateAtom).root).flatMap((leaf) =>
		leaf.tabs.filter((tab) => tab.componentId === TERMINAL_PANEL_ID).map((tab) => tab.tabId),
	);
}

describe("头部终端入口", () => {
	it("面板隐藏且有终端：唤起面板并回到最近用过的终端，而不是排在最后的那个", async () => {
		const { store, click } = setup(
			"/workspace",
			open("t1"),
			open("t2"),
			{ type: "activate-tab", tabId: "t1" },
			open("p1", PLUGIN_ID),
			{ type: "set-collapsed", collapsed: true },
		);

		await click();

		const state = store.get(bottomPanelStateAtom);
		expect(state.collapsed).toBe(false);
		expect(activeBottomPanelTab(state)?.tabId).toBe("t1");
		expect(terminalTabIds(store)).toEqual(["t1", "t2"]);
		expect(store.get(bottomPanelFocusRequestAtom)).toBe("t1");
	});

	it("面板隐藏且没有终端：展开并新建一个终端", async () => {
		const { store, click } = setup();

		await click();

		const state = store.get(bottomPanelStateAtom);
		const [created] = terminalTabIds(store);
		expect(state.collapsed).toBe(false);
		expect(created).toBeDefined();
		expect(activeBottomPanelTab(state)?.tabId).toBe(created);
		expect(store.get(bottomPanelFocusRequestAtom)).toBe(created);
	});

	it("面板显示但没有终端：新建的终端追加到当前格子", async () => {
		const { store, click } = setup("/workspace", open("p1", PLUGIN_ID));

		await click();

		const leaves = collectBottomPanelLeaves(store.get(bottomPanelStateAtom).root);
		expect(leaves).toHaveLength(1);
		expect(leaves[0]?.tabs.map((tab) => tab.componentId)).toEqual([PLUGIN_ID, TERMINAL_PANEL_ID]);
	});

	it("面板显示、有终端但正看着别的 tab：切到最近用过的终端，不新建", async () => {
		const { store, click } = setup("/workspace", open("t1"), open("p1", PLUGIN_ID));

		await click();

		expect(activeBottomPanelTab(store.get(bottomPanelStateAtom))?.tabId).toBe("t1");
		expect(terminalTabIds(store)).toEqual(["t1"]);
		expect(store.get(bottomPanelFocusRequestAtom)).toBe("t1");
	});

	it("已经在终端里：按钮呈按下态，点了什么都不改，也不抢焦点", async () => {
		const { store, button, click } = setup("/workspace", open("t1"));
		const before = store.get(bottomPanelStateAtom);

		expect(button.getAttribute("aria-pressed")).toBe("true");
		await click();

		expect(store.get(bottomPanelStateAtom)).toBe(before);
		expect(store.get(bottomPanelFocusRequestAtom)).toBeNull();
	});

	it("本地会话缺本机 PTY 时禁用；远程会话不受本机能力影响", () => {
		capabilities.localPty = false;
		try {
			const local = setup("/workspace");
			expect(local.button.hasAttribute("disabled")).toBe(true);
			cleanup();

			const remote = setup("ssh://host-1/home/me/project");
			expect(remote.button.hasAttribute("disabled")).toBe(false);
		} finally {
			capabilities.localPty = true;
		}
	});
});
