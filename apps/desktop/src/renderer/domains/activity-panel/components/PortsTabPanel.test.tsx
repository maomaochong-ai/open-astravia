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
	openPortForward: vi.fn(async (request: { hostId: string; remotePort: number; localPort?: number; label?: string }) => {
		const forward: PortForward = {
			hostId: request.hostId,
			remotePort: request.remotePort,
			localPort: request.localPort ?? request.remotePort,
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
	terminateRemoteProcess: vi.fn(async (_input: { hostId: string; pid: number; force?: boolean }) => {
		return { exited: true };
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
			localPort: undefined,
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
			localPort: undefined,
			label: undefined,
			source: "detected",
		});
		// 映射之后还是同一行，只是多了本机地址——不会在别处重复出现一次。
		expect(await screen.findByText("localhost:5173")).toBeTruthy();
		expect(screen.getAllByText("5173")).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "activityPanel.ports.forward" })).toBeNull();
	});

	it("手动填一个端口号也能转发，非法输入就地提示且不发请求", async () => {
		const user = userEvent.setup();
		renderPanel();
		const input = await screen.findByPlaceholderText("activityPanel.ports.remotePortPlaceholder");

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
			localPort: undefined,
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

		await user.type(await screen.findByPlaceholderText("activityPanel.ports.remotePortPlaceholder"), "3000");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.add" }));

		expect(await screen.findByText(/AllowTcpForwarding/)).toBeTruthy();
	});

	it("停止转发后它回到候选里，不必重新扫描", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "0.0.0.0", processName: "node" }] };
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
			localPort: undefined,
			label: undefined,
			source: "manual",
		});
	});

	it("远端没有扫描工具时说明情况并留下手动入口，不谎称「没有端口在听」", async () => {
		scan = { tool: "none", ports: [] };
		renderPanel();

		expect(await screen.findByText("activityPanel.ports.scanUnsupported")).toBeTruthy();
		expect(screen.getByPlaceholderText("activityPanel.ports.remotePortPlaceholder")).toBeTruthy();
	});

	it("本机端口能由用户自己改：远端 5173 想落在本机 5174 就填 5174", async () => {
		// 本机 5173 被别的东西占着时，系统自动换的那个随机号用户并没得选，而框架常把端口号写进
		// HMR 与绝对 URL 里，所以「我要它落在这个号」是真实需求。
		const user = userEvent.setup();
		renderPanel();

		await user.type(await screen.findByPlaceholderText("activityPanel.ports.remotePortPlaceholder"), "5173");
		await user.type(screen.getByPlaceholderText("activityPanel.ports.localPortPlaceholder"), "5174");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.add" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 5173,
			localPort: 5174,
			label: undefined,
			source: "manual",
		});
		expect(await screen.findByText("localhost:5174")).toBeTruthy();
	});

	it("已转发的那条也能就地改本机端口", async () => {
		ledger = [
			{
				hostId: "host-1",
				remotePort: 5173,
				localPort: 52341,
				label: "vite",
				source: "manual",
				status: "active",
				createdAt: 0,
			},
		];
		const user = userEvent.setup();
		renderPanel();

		// 自动换号后的地址就摆在那里，点它即可改。
		await user.click(await screen.findByRole("button", { name: "activityPanel.ports.changeLocalPort" }));
		const input = screen.getByLabelText("activityPanel.ports.changeLocalPort");
		await user.clear(input);
		await user.type(input, "5174");
		await user.click(screen.getByRole("button", { name: "common:actions.save" }));

		expect(ssh.openPortForward).toHaveBeenCalledWith({
			hostId: "host-1",
			remotePort: 5173,
			localPort: 5174,
			label: "vite",
			source: "manual",
		});
		expect(await screen.findByText("localhost:5174")).toBeTruthy();
	});

	it("改号时点取消就什么都不做", async () => {
		ledger = [
			{
				hostId: "host-1",
				remotePort: 5173,
				localPort: 5173,
				source: "manual",
				status: "active",
				createdAt: 0,
			},
		];
		const user = userEvent.setup();
		renderPanel();

		await user.click(await screen.findByRole("button", { name: "activityPanel.ports.changeLocalPort" }));
		await user.click(screen.getByRole("button", { name: "common:actions.cancel" }));

		expect(ssh.openPortForward).not.toHaveBeenCalled();
		expect(screen.getByText("localhost:5173")).toBeTruthy();
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

	it("一行列出端口、进程名与命令行，按启动时间从新到旧排", async () => {
		const now = Date.now();
		scan = {
			tool: "helper",
			ports: [
				{ port: 5432, address: "127.0.0.1", processName: "postgres", pid: 10, startedAt: now - 86_400_000 },
				{
					port: 5173,
					address: "0.0.0.0",
					processName: "node",
					pid: 11,
					command: "node /srv/app/node_modules/.bin/vite",
					startedAt: now - 120_000,
				},
				{ port: 8000, address: "127.0.0.1", processName: "python3", pid: 12, startedAt: now - 3_600_000 },
			],
		};
		renderPanel();

		expect(await screen.findByText("node /srv/app/node_modules/.bin/vite")).toBeTruthy();
		const order = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
		expect(order[0]).toContain("5173");
		expect(order[1]).toContain("8000");
		expect(order[2]).toContain("5432");
		// 绑在所有网卡上的那个标出来：远端网络里的别人也能连到它。
		expect(screen.getByLabelText("activityPanel.ports.publicBind")).toBeTruthy();
	});

	it("22 这类系统端口折叠在末尾，展开后也不给终止", async () => {
		scan = {
			tool: "ss",
			ports: [
				{ port: 22, address: "0.0.0.0", processName: "sshd", pid: 800, sensitive: true },
				{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 },
			],
		};
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("3000");
		expect(screen.queryByText("sshd")).toBeNull();
		// 只有 3000 那一行能终止。
		expect(screen.getAllByRole("button", { name: "activityPanel.ports.terminate" })).toHaveLength(1);

		await user.click(screen.getByRole("button", { name: "activityPanel.ports.sensitiveToggle" }));

		expect(screen.getByText("sshd")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "activityPanel.ports.terminate" })).toHaveLength(1);
	});

	it("终止要先确认；进程退了就撤掉它的映射并重新扫描", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 }] };
		ledger = [
			{ hostId: "host-1", remotePort: 3000, localPort: 3000, source: "manual", status: "active", createdAt: 0 },
		];
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("localhost:3000");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));
		// 第一下只是问一句，还没发出去。
		expect(ssh.terminateRemoteProcess).not.toHaveBeenCalled();
		expect(screen.getByText("activityPanel.ports.terminateConfirm")).toBeTruthy();

		scan = { tool: "ss", ports: [] };
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));

		expect(ssh.terminateRemoteProcess).toHaveBeenCalledWith({ hostId: "host-1", pid: 1234, force: false });
		expect(ssh.closePortForward).toHaveBeenCalledWith({ hostId: "host-1", remotePort: 3000 });
		await waitFor(() => expect(screen.queryByText("3000")).toBeNull());
		expect(ssh.listListeningPorts).toHaveBeenCalledTimes(2);
	});

	it("SIGTERM 没收掉时如实告知，下一次改发 SIGKILL", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 }] };
		ssh.terminateRemoteProcess.mockResolvedValueOnce({ exited: false });
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("3000");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));

		expect(await screen.findByText("activityPanel.ports.terminateStubborn")).toBeTruthy();
		// 行还在，按钮换成了强制终止。
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.forceTerminate" }));
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.forceTerminate" }));

		expect(ssh.terminateRemoteProcess).toHaveBeenLastCalledWith({ hostId: "host-1", pid: 1234, force: true });
	});

	it("没权限终止时把原因摆出来，行保持原样", async () => {
		scan = { tool: "ss", ports: [{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1234 }] };
		ssh.terminateRemoteProcess.mockRejectedValueOnce(new Error("Operation not permitted"));
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("3000");
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));
		await user.click(screen.getByRole("button", { name: "activityPanel.ports.terminate" }));

		expect(await screen.findByText("activityPanel.ports.terminateFailed")).toBeTruthy();
		expect(screen.getByText("3000")).toBeTruthy();
	});

	it("映射还在但远端已没人监听那个端口时标出来，而不是装作一切正常", async () => {
		scan = { tool: "ss", ports: [] };
		ledger = [
			{ hostId: "host-1", remotePort: 3000, localPort: 3000, source: "manual", status: "active", createdAt: 0 },
		];
		renderPanel();

		expect(await screen.findByText("activityPanel.ports.notListening")).toBeTruthy();
	});

	it("认不出进程的端口折叠起来，已映射的那个除外", async () => {
		scan = {
			tool: "ss",
			ports: [
				{ port: 3000, address: "127.0.0.1", processName: "node", pid: 1 },
				{ port: 1200, address: "0.0.0.0" },
				{ port: 4321, address: "0.0.0.0" },
				{ port: 5001, address: "0.0.0.0" },
			],
		};
		ledger = [
			{ hostId: "host-1", remotePort: 5001, localPort: 5001, source: "manual", status: "active", createdAt: 0 },
		];
		const user = userEvent.setup();
		renderPanel();

		await screen.findByText("3000");
		expect(screen.getByText("5001")).toBeTruthy();
		expect(screen.queryByText("1200")).toBeNull();
		expect(screen.queryByText("4321")).toBeNull();

		await user.click(screen.getByRole("button", { name: "activityPanel.ports.unnamedToggle" }));

		expect(screen.getByText("1200")).toBeTruthy();
		expect(screen.getByText("4321")).toBeTruthy();
	});

	it("被内核截断的进程名换成命令行里的完整名字，且不重复成两行", async () => {
		scan = {
			tool: "helper",
			ports: [
				{ port: 28028, address: "127.0.0.1", processName: "sglang::schedul", pid: 9, command: "sglang::scheduler_TP1" },
			],
		};
		renderPanel();

		expect(await screen.findByText("sglang::scheduler_TP1")).toBeTruthy();
		expect(screen.getAllByText("sglang::scheduler_TP1")).toHaveLength(1);
		expect(screen.queryByText("sglang::schedul")).toBeNull();
	});
});
