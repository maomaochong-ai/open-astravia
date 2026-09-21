// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	activeInputDraftKeyAtom,
	activeSessionAtom,
	bottomPanelStateAtom,
	collectBottomPanelLeaves,
	confirmDialogAtom,
	currentScenarioAtom,
	dispatchBottomPanelAtom,
	pluginBottomPanelsAtom,
	type RegisteredBottomPanel,
} from "@shared/store/atoms";
import { createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import { type JSX, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBottomPanelInstance } from "../registry/instance-context";
import { BottomPanelHost } from "./BottomPanelHost";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

/**
 * 用一个 fake 插件面板当被测组件，而不是内置终端：
 * 这条路径是生产代码里真实存在的（插件贡献池），不需要为测试开后门，
 * 也不用在 jsdom 里假造 xterm 与 PTY。
 */
function makePanel(overrides: Partial<RegisteredBottomPanel> = {}): RegisteredBottomPanel {
	return {
		pluginId: "demo",
		pluginName: "Demo 插件",
		panelId: "logs",
		label: "日志",
		component: DemoPanelBody,
		scope_use: ["project"],
		...overrides,
	};
}

/** 按实例记挂载次数：折叠不该重挂，重挂就意味着里面的进程被杀过一次。 */
let mountCounts: Record<string, number> = {};

function DemoPanelBody(): JSX.Element {
	const handle = useBottomPanelInstance();
	const tabId = handle.tabId;
	useEffect(() => {
		mountCounts[tabId] = (mountCounts[tabId] ?? 0) + 1;
	}, [tabId]);
	return (
		<div>
			<p>panel-body-{handle.tabId}</p>
			<button type="button" onClick={() => handle.setMeta({ label: "改过的名字", status: "active" })}>
				rename
			</button>
			<button
				type="button"
				onClick={() =>
					handle.setCloseGuard(async () => ({ title: "还在跑", message: "关掉会中断", confirmLabel: "仍然关闭" }))
				}
			>
				guard
			</button>
		</div>
	);
}

/** 把「右上角按钮」和「折叠 pill」这两个入口一起挂上，测的是用户真实走的路径。 */
function Harness(): JSX.Element {
	const state = useAtomValue(bottomPanelStateAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtom);
	const confirm = useAtomValue(confirmDialogAtom);
	return (
		<>
			<button type="button" onClick={() => dispatch({ type: "set-collapsed", collapsed: !state.collapsed })}>
				toggle-bottom-panel
			</button>
			<BottomPanelHost />
			{confirm ? (
				<div role="dialog" aria-label={confirm.title}>
					<p>{confirm.message}</p>
					<button type="button" onClick={() => confirm.onConfirm(false)}>
						{confirm.confirmLabel ?? "confirm"}
					</button>
					<button type="button" onClick={() => confirm.onCancel?.()}>
						cancel
					</button>
				</div>
			) : null}
		</>
	);
}

function setup(panels: RegisteredBottomPanel[] = [makePanel()]) {
	const store = createStore();
	store.set(activeSessionAtom, { cwd: "/workspace", sessionPath: "/session.json", runtimeId: "session" });
	store.set(activeInputDraftKeyAtom, "/session.json");
	store.set(currentScenarioAtom, "project");
	store.set(pluginBottomPanelsAtom, panels);
	const view = render(
		<Provider store={store}>
			<Harness />
		</Provider>,
	);
	return { store, user: userEvent.setup(), ...view };
}

function leafCount(store: ReturnType<typeof createStore>): number {
	return collectBottomPanelLeaves(store.get(bottomPanelStateAtom).root).length;
}

/**
 * 空态直接把可添加的面板摊平成一排，点一下就加——面板空着时唯一能做的事就是添加第一个 tab，
 * 再套一层「+」菜单纯属多余。面板非空之后才走 tab 条右侧的「+」菜单。
 */
async function addFromEmptyState(user: ReturnType<typeof userEvent.setup>): Promise<void> {
	await user.click(await screen.findByRole("button", { name: /^日志/ }));
}

async function addFromMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
	await user.click(screen.getAllByRole("button", { name: "bottomPanel.actions.add" })[0]!);
	await user.click(await screen.findByRole("button", { name: /^日志/ }));
}

beforeEach(() => {
	mountCounts = {};
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => storage.clear(),
		getItem: (key: string) => storage.get(key) ?? null,
		removeItem: (key: string) => void storage.delete(key),
		setItem: (key: string, value: string) => void storage.set(key, value),
	});
	Object.assign(window, {
		vetta: { terminal: { capabilities: async () => ({ localPty: false, unavailableReason: "no pty in test" }) } },
	});
});

describe("底部面板：常见使用流程", () => {
	it("默认收起，点右上角按钮出现空态，空态里列出可添加的面板、点一下即添加", async () => {
		const { user, store } = setup();
		expect(screen.queryByText("bottomPanel.empty.title")).toBeNull();

		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		expect(screen.getByText("bottomPanel.empty.title")).not.toBeNull();

		await addFromEmptyState(user);

		expect(await screen.findByRole("tab", { name: /日志/ })).not.toBeNull();
		expect(leafCount(store)).toBe(1);
	});

	it("同一个面板可以开多个实例，各自独立", async () => {
		const { user, store } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);
		await addFromMenu(user);

		expect(screen.getAllByRole("tab")).toHaveLength(2);
		const tabs = store.get(bottomPanelStateAtom).root;
		expect(collectBottomPanelLeaves(tabs)[0]?.tabs).toHaveLength(2);
	});

	it("实例能实时改名与点亮状态点，tab 条立刻跟上", async () => {
		const { user } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);

		await user.click(screen.getByRole("button", { name: "rename" }));

		expect(await screen.findByRole("tab", { name: /改过的名字/ })).not.toBeNull();
		expect(document.querySelector('[data-status="active"]')).not.toBeNull();
	});

	it("分屏后两格并存，关掉一格树会塌缩回单格", async () => {
		const { user, store } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);

		await user.click(screen.getAllByRole("button", { name: "bottomPanel.actions.splitRight" })[0]!);
		expect(leafCount(store)).toBe(2);
		expect(screen.getAllByRole("tab")).toHaveLength(2);

		await user.click(screen.getAllByRole("button", { name: /bottomPanel.closeTab/ })[1]!);

		await waitFor(() => expect(leafCount(store)).toBe(1));
	});

	it("贡献方装了关闭守卫时先弹确认：取消保留，确认才关", async () => {
		const { user, store } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);
		await user.click(screen.getByRole("button", { name: "guard" }));

		await user.click(screen.getByRole("button", { name: /bottomPanel.closeTab/ }));
		const dialog = await screen.findByRole("dialog", { name: "还在跑" });
		await user.click(screen.getByRole("button", { name: "cancel" }));
		expect(store.get(bottomPanelStateAtom).root).not.toBeNull();
		await waitFor(() => expect(dialog.isConnected).toBe(false));

		await user.click(screen.getByRole("button", { name: /bottomPanel.closeTab/ }));
		await user.click(await screen.findByRole("button", { name: "仍然关闭" }));

		await waitFor(() => expect(store.get(bottomPanelStateAtom).root).toBeNull());
	});

	it("折叠只是藏起来：布局留着，内容组件不重挂", async () => {
		const { user, store } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);
		const tabId = collectBottomPanelLeaves(store.get(bottomPanelStateAtom).root)[0]?.tabs[0]?.tabId ?? "";
		expect(mountCounts[tabId]).toBe(1);

		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		// 折叠态下 tab 仍在 DOM 里，只是整块被 hidden 隐去（role 查询默认跳过隐藏内容）。
		expect(document.querySelector<HTMLElement>("[data-bottom-panel-root]")?.hidden).toBe(true);
		expect(screen.queryByRole("tab", { name: /日志/ })).toBeNull();
		expect(screen.getByRole("tab", { name: /日志/, hidden: true })).not.toBeNull();
		expect(store.get(bottomPanelStateAtom).root).not.toBeNull();

		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		// 折叠只是把面板藏起来：内容组件一旦重挂，里面的进程和滚动缓冲就全丢了。
		expect(mountCounts[tabId]).toBe(1);
	});

	it("布局写进了 localStorage，按会话主键分桶", async () => {
		const { user } = setup();
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);

		const raw = localStorage.getItem("vetta-bottom-panel-layout");
		expect(raw).toContain("/session.json");
		expect(raw).toContain("plugin:demo:logs");
	});

	it("场景不匹配的插件面板不出现在可添加列表里（fail-closed）", async () => {
		const { user } = setup([makePanel({ scope_use: ["batch"] })]);
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));

		expect(screen.getByText("bottomPanel.empty.title")).not.toBeNull();
		expect(screen.queryByRole("button", { name: /^日志/ })).toBeNull();
	});

	it("单例面板开过一个之后菜单项被禁用", async () => {
		const { user } = setup([makePanel({ maxInstances: 1 })]);
		await user.click(screen.getByRole("button", { name: "toggle-bottom-panel" }));
		await addFromEmptyState(user);

		await user.click(screen.getAllByRole("button", { name: "bottomPanel.actions.add" })[0]!);

		const row = await screen.findByRole("button", { name: /^日志/ });
		expect((row as HTMLButtonElement).disabled).toBe(true);
	});
});
