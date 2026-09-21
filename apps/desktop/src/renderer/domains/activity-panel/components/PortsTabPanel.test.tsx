// @vitest-environment jsdom
import type { PortForward } from "@preload/api-types/ssh";
import { activityPanelTabByProjectAtom, backgroundTasksBySessionAtom, browserUrlByWorkspaceAtom } from "@shared/store/atoms";
import type { BackgroundTask } from "@shared/store/background-tasks-atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { RemoteListenerScan } from "@vetta/ssh-transport";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPanelContextProvider } from "../registry/context";
import { PortsTabPanel } from "./PortsTabPanel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const REMOTE_CWD = "ssh://host-1/home/me/app";

/** 主进程侧的转发账本：由 openPortForward / closePortForward 改写，并广播给界面。 */
let ledger: PortForward[] = [];
let listeners: (() => void)[] = [];
let scan: RemoteListenerScan = { tool: "ss", ports: [] };

function notify(): void {
	for (const listener of listeners) listener();
}

const ssh = {
	listListeningPorts: vi.fn(async () => scan),
	listPortForwards: vi.fn(async () => ledger),
	openPortForward: vi.fn(async (request: { hostId: string; remotePort: number; label?: string }) => {
		const forward: PortForward = {
			hostId: request.hostId,
			remotePort: request.remotePort,
			localPort: request.remotePort,
			label: request.label,
			source: "manual",
			status: "active",
			createdAt: 0,
		};
		ledger = [...ledger.filter((entry) => entry.remotePort !== forward.remotePort), forward];
		notify();
		return forward;
	}),
	closePortForward: vi.fn(async ({ remotePort }: { remotePort: number }) => {
		ledger = ledger.filter((entry) => entry.remotePort !== remotePort);
		notify();
	}),
	onPortForwardsChanged: vi.fn((listener: () => void) => {
		listeners.push(listener);
		return () => {
			listeners = listeners.filter((entry) => entry !== listener);
		};
	}),
};

const openExternal = vi.fn(async () => {});

vi.stubGlobal("window", Object.assign(globalThis.window, { vetta: { ssh, auth: { openExternal } } }));

function renderPanel(store = createStore(), cwd = REMOTE_CWD) {
	const workspace = createActivityWorkspace(cwd, cwd, ["runtime-1"]);
	const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
		<Provider store={store}>
			<ActivityPanelContextProvider value={{ workspace, knowledgeHistory: false }}>
				{children}
			</ActivityPanelContextProvider>
		</Provider>
	);
	return { store, ...render(<PortsTabPanel />, { wrapper }) };
}

beforeEach(() => {
	vi.clearAllMocks();
	ledger = [];
	listeners = [];
	scan = { tool: "ss", ports: [] };
});
afterEach(cleanup);

describe("端口面板", () => {
	it("把远端在听的端口摆成候选，点一下就转发过来并能在应用内预览", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "0.0.0.0", processName: "next-server" }] };
		const user = userEvent.setup();
		const { store } = renderPanel();

		// 候选带着进程名，用户靠它认出是哪个服务。
		expect(await screen.findByText("3000")).toBeTruthy();
		expect(screen.getByText("next-server")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "activityPanel.ports.forward" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 3000,
			label: "next-server",
			source: "detected",
		});
		// 转发成功后它从候选移到「已转发」，本机地址就地可见。
		expect(await screen.findByText("localhost:3000")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "activityPanel.ports.forward" })).toBeNull();

		await user.click(screen.getByRole("button", { name: "activityPanel.ports.preview" }));

		// 预览走同一个面板里的内置浏览器：不必离开应用。
		await waitFor(() => {
			expect(store.get(browserUrlByWorkspaceAtom).get(REMOTE_CWD)).toBe("http://localhost:3000");
			expect(store.get(activityPanelTabByProjectAtom).get(REMOTE_CWD)).toBe("browser");
		});
	});

	it("后台任务打出地址后端口立刻出现在候选里，不必等扫描", async () => {
		// dev server 一起来就把地址打出来了，那是用户此刻最想看的东西；远端没有扫描工具时
		// 这还是唯一的线索。
		const store = createStore();
		store.set(
			backgroundTasksBySessionAtom,
			new Map<string, BackgroundTask[]>([
				[
					"runtime-1",
					[
						{
							id: "task-1",
							command: "npm run dev",
							cwd: REMOTE_CWD,
							status: "running",
							outputFile: "/tmp/out.log",
							exitCode: undefined,
							startedAt: 0,
							tail: "  ➜  Local:   http://localhost:5173/",
						},
						// 本机的任务不算：它的端口本来就在本机，转发它没有意义。
						{
							id: "task-2",
							command: "npm run docs",
							cwd: "/Users/me/other",
							status: "running",
							outputFile: "/tmp/out2.log",
							exitCode: undefined,
							startedAt: 0,
							tail: "http://localhost:4321/",
						},
					],
				],
			]),
		);
		const user = userEvent.setup();
		renderPanel(store);

		expect(await screen.findByText("5173")).toBeTruthy();
		expect(screen.getByText("activityPanel.ports.fromOutput")).toBeTruthy();
		expect(screen.queryByText("4321")).toBeNull();

		await user.click(screen.getByRole("button", { name: "activityPanel.ports.forward" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 5173,
			label: undefined,
			source: "detected",
		});
		// 转发之后它不再作为候选重复出现。
		await waitFor(() => expect(screen.queryByText("activityPanel.ports.fromOutput")).toBeNull());
	});

	it("手动填一个端口号也能转发，非法输入就地提示且不发请求", async () => {
		const user = userEvent.setup();
		renderPanel();
		const input = await screen.findByPlaceholderText("activityPanel.ports.addPlaceholder");

		await user.type(input, "99999");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.add" }));

		expect(screen.getByText("activityPanel.ports.invalidPort")).toBeTruthy();
		expect(ssh.openPortForward).not.toHaveBeenCalled();

		await user.clear(input);
		await user.type(input, "5173");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.add" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 5173,
			label: undefined,
			source: "manual",
		});
		expect(await screen.findByText("localhost:5173")).toBeTruthy();
	});

	it("远端 sshd 关掉了转发时原因就地可见，输入不被清掉之外的东西不受影响", async () => {
		ssh.openPortForward.mockRejectedValueOnce(
			new Error("The SSH server may have TCP forwarding disabled (AllowTcpForwarding)."),
		);
		const user = userEvent.setup();
		renderPanel();

		await user.type(await screen.findByPlaceholderText("activityPanel.ports.addPlaceholder"), "3000");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.add" }));

		expect(await screen.findByText(/AllowTcpForwarding/)).toBeTruthy();
	});

	it("停止转发后它回到候选里，不必重新扫描", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "0.0.0.0" }] };
		ledger = [
			{
				hostId: "host-1",
				remotePort: 3000,
				localPort: 3000,
				source: "manual",
				status: "active",
				createdAt: 0,
			},
		];
		const user = userEvent.setup();
		renderPanel();

		expect(await screen.findByText("localhost:3000")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.stop" }));

		expect(ssh.closePortForward).toHaveBeenCalledWith({ hostId: "host-1", remotePort: 3000 });
		await waitFor(() => expect(screen.queryByText("localhost:3000")).toBeNull());
		expect(screen.getByRole("button", { name: "activityPanel.ports.forward" })).toBeTruthy();
	});

	it("转发断开后给出原因和重试，而不是让用户对着一个连不上的地址发呆", async () => {
		ledger = [
			{
				hostId: "host-1",
				remotePort: 3000,
				localPort: 3000,
				source: "manual",
				status: "failed",
				error: "Connection closed by remote host",
				createdAt: 0,
			},
		];
		const user = userEvent.setup();
		renderPanel();

		expect(await screen.findByText(/Connection closed by remote host/)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.retry" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 3000,
			label: undefined,
			source: "manual",
		});
	});

	it("远端没有扫描工具时说明情况并留下手动入口，不谎称「没有端口在听」", async () => {
		scan = { tool: "none", ports: [] };
		renderPanel();

		expect(await screen.findByText("activityPanel.ports.scanUnsupported")).toBeTruthy();
		expect(screen.getByPlaceholderText("activityPanel.ports.addPlaceholder")).toBeTruthy();
	});

	it("本机端口被占用而换了号时明确提示按本机那个号访问", async () => {
		ledger = [
			{
				hostId: "host-1",
				remotePort: 5173,
				localPort: 52341,
				source: "manual",
				status: "active",
				createdAt: 0,
			},
		];
		renderPanel();

		expect(await screen.findByText("localhost:52341")).toBeTruthy();
		expect(screen.getByText("activityPanel.ports.portChanged")).toBeTruthy();
	});

	it("用系统浏览器打开的是转发后的本机地址", async () => {
		ledger = [
			{
				hostId: "host-1",
				remotePort: 3000,
				localPort: 3000,
				source: "manual",
				status: "active",
				createdAt: 0,
			},
		];
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: "activityPanel.ports.openExternal" }));

		expect(openExternal).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("本机项目下不去问远端端口", async () => {
		renderPanel(createStore(), "/Users/me/app");

		await waitFor(() => expect(ssh.listListeningPorts).not.toHaveBeenCalled());
		expect(ssh.listPortForwards).not.toHaveBeenCalled();
	});
});
