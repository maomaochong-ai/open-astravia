// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	bottomPanelStateAtomFamily,
	collectBottomPanelLeaves,
	dispatchBottomPanelAtomFamily,
	pluginBottomPanelsAtom,
	type RegisteredBottomPanel,
} from "@shared/store/atoms";
import { useBottomPanel } from "@vetta-org/plugin-sdk";
import { createStore, Provider, useSetAtom } from "jotai";
import { type JSX, useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTerminalCapabilitiesCacheForTests } from "../hooks/useTerminalCapabilities";
import { useBottomPanelInstance } from "../registry/instance-context";
import { readTerminalLaunchPayload } from "../terminal/terminal-launch";
import { BottomPanelHost } from "./BottomPanelHost";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

/**
 * xterm 与 PTY 是真实的外部边界，jsdom 里跑不起来；这里换成只报出「这个终端要在哪敲什么」的替身。
 * 真正的「只敲一次」由 `claimTerminalLaunch` 的单测覆盖。
 */
vi.mock("../terminal/TerminalSurface", () => ({
	TerminalSurface: function FakeTerminal(): JSX.Element {
		const handle = useBottomPanelInstance();
		const launch = readTerminalLaunchPayload(handle.payload, handle.cwd);
		useEffect(() => {
			if (launch?.label) handle.setMeta({ label: launch.label });
		}, [handle, launch?.label]);
		return <p>{launch ? `terminal:${launch.command}@${launch.cwd ?? handle.cwd}` : "terminal:plain"}</p>;
	},
}));

const SCOPE = { key: "/session.json", cwd: "/workspace", scenario: "project" as const };

function ScriptsPanel(): JSX.Element {
	const handle = useBottomPanelInstance();
	const [launched, setLaunched] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const attempt = (action: () => void): void => {
		try {
			action();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		}
	};
	return (
		<div>
			<button
				type="button"
				onClick={() =>
					attempt(() =>
						setLaunched(
							handle.openTerminal({ command: "bun run dev", cwd: "/workspace/apps/web", label: "web: dev" }),
						),
					)
				}
			>
				run-dev
			</button>
			<button type="button" onClick={() => setMessage(String(launched ? handle.revealTab(launched) : false))}>
				reveal
			</button>
			<button type="button" onClick={() => attempt(() => handle.openTerminal({ command: "ls", cwd: "/etc" }))}>
				run-outside
			</button>
			<p>message:{message}</p>
		</div>
	);
}

const scriptsPanel: RegisteredBottomPanel = {
	pluginId: "scripts",
	pluginName: "Scripts",
	panelId: "scripts",
	label: "脚本",
	component: ScriptsPanel,
	scope_use: ["project"],
};

function Harness(): JSX.Element {
	const dispatch = useSetAtom(dispatchBottomPanelAtomFamily(SCOPE.key));
	return (
		<>
			<button
				type="button"
				onClick={() =>
					dispatch({ type: "open-tab", tabId: "scripts-tab", componentId: "plugin:scripts:scripts", newLeafId: "leaf-1" })
				}
			>
				open-scripts
			</button>
			<BottomPanelHost scope={SCOPE} />
		</>
	);
}

/** 插件作者写的面板：走 SDK 的 `useBottomPanel()`，而不是宿主内部的实例控制面。 */
function PluginScriptsPanel(): JSX.Element {
	const { openTerminal, revealInstance } = useBottomPanel();
	const [launched, setLaunched] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	return (
		<div>
			<button
				type="button"
				onClick={() => {
					try {
						setLaunched(openTerminal({ command: "make test", label: "make test" }));
					} catch (error) {
						setMessage(error instanceof Error ? error.message : String(error));
					}
				}}
			>
				plugin-run
			</button>
			<button type="button" onClick={() => setMessage(String(launched ? revealInstance(launched) : false))}>
				plugin-reveal
			</button>
			<p>message:{message}</p>
		</div>
	);
}

function setup(localPty: boolean, panels: RegisteredBottomPanel[] = [scriptsPanel]) {
	const capabilities = vi.fn(async () => ({ localPty }));
	Object.assign(window, { vetta: { terminal: { capabilities } } });
	const store = createStore();
	store.set(pluginBottomPanelsAtom, panels);
	render(
		<Provider store={store}>
			<Harness />
		</Provider>,
	);
	return { store, user: userEvent.setup(), capabilities };
}

function leaves(store: ReturnType<typeof createStore>) {
	return collectBottomPanelLeaves(store.get(bottomPanelStateAtomFamily(SCOPE.key)).root);
}

beforeEach(() => {
	resetTerminalCapabilitiesCacheForTests();
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => storage.clear(),
		getItem: (key: string) => storage.get(key) ?? null,
		removeItem: (key: string) => void storage.delete(key),
		setItem: (key: string, value: string) => void storage.set(key, value),
	});
});

describe("面板替用户开终端跑命令", () => {
	it("点一下就在同一格里开出带名字的终端，切回脚本页后能一键回到它，关掉后回不去", async () => {
		const { store, user } = setup(true);
		await user.click(screen.getByRole("button", { name: "open-scripts" }));

		await user.click(await screen.findByRole("button", { name: "run-dev" }));

		expect(await screen.findByText("terminal:bun run dev@/workspace/apps/web")).not.toBeNull();
		expect(await screen.findByRole("tab", { name: /web: dev/ })).not.toBeNull();
		const [leaf] = leaves(store);
		expect(leaves(store)).toHaveLength(1);
		expect(leaf?.tabs.map((tab) => tab.componentId)).toEqual(["plugin:scripts:scripts", "terminal"]);
		expect(leaf?.activeTabId).toBe(leaf?.tabs[1]?.tabId);
		expect(leaf?.tabs[1]?.payload).toMatchObject({ kind: "terminal-launch", command: "bun run dev", issued: false });

		await user.click(screen.getByRole("tab", { name: /脚本/ }));
		await user.click(screen.getByRole("button", { name: "reveal" }));
		expect(screen.getByText("message:true")).not.toBeNull();
		await waitFor(() => expect(leaves(store)[0]?.activeTabId).toBe(leaf?.tabs[1]?.tabId));

		await user.click(screen.getAllByRole("button", { name: /bottomPanel.closeTab/ })[1]!);
		await waitFor(() => expect(leaves(store)[0]?.tabs).toHaveLength(1));
		await user.click(screen.getByRole("button", { name: "reveal" }));
		expect(screen.getByText("message:false")).not.toBeNull();
	});

	it("目录越出会话 cwd 时拒绝，不开任何终端", async () => {
		const { store, user } = setup(true);
		await user.click(screen.getByRole("button", { name: "open-scripts" }));

		await user.click(await screen.findByRole("button", { name: "run-outside" }));

		expect(screen.getByText(/message:openTerminal: cwd must be/)).not.toBeNull();
		expect(leaves(store)[0]?.tabs).toHaveLength(1);
	});

	it("本机没有 PTY 的本地会话里拒绝开终端", async () => {
		const { store, user, capabilities } = setup(false);
		await user.click(screen.getByRole("button", { name: "open-scripts" }));
		// 能力探测默认乐观；等它回来、终端从可用组件里退场之后再点。
		await waitFor(() => expect(capabilities).toHaveBeenCalled());
		await act(async () => {});

		await user.click(await screen.findByRole("button", { name: "run-dev" }));

		expect(screen.getByText(/message:openTerminal: terminals are not available/)).not.toBeNull();
		expect(leaves(store)[0]?.tabs).toHaveLength(1);
	});
});

describe("插件经 useBottomPanel() 开终端", () => {
	const pluginPanel = (terminalAccess: boolean): RegisteredBottomPanel => ({
		...scriptsPanel,
		component: PluginScriptsPanel,
		terminalAccess,
	});

	it("持有 terminal.run 的插件开出终端，并能按返回的 id 切回去", async () => {
		const { store, user } = setup(true, [pluginPanel(true)]);
		await user.click(screen.getByRole("button", { name: "open-scripts" }));

		await user.click(await screen.findByRole("button", { name: "plugin-run" }));

		expect(await screen.findByText("terminal:make test@/workspace")).not.toBeNull();
		await user.click(screen.getByRole("tab", { name: /脚本/ }));
		await user.click(screen.getByRole("button", { name: "plugin-reveal" }));
		expect(screen.getByText("message:true")).not.toBeNull();
		await waitFor(() => expect(leaves(store)[0]?.activeTabId).toBe(leaves(store)[0]?.tabs[1]?.tabId));
	});

	it("没有 terminal.run 时抛出权限错误，不开终端", async () => {
		const { store, user } = setup(true, [pluginPanel(false)]);
		await user.click(screen.getByRole("button", { name: "open-scripts" }));

		await user.click(await screen.findByRole("button", { name: "plugin-run" }));

		expect(screen.getByText("message:Plugin permission denied: terminal.run")).not.toBeNull();
		expect(leaves(store)[0]?.tabs).toHaveLength(1);
	});
});
