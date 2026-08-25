/**
 * 面板的四态安装流程：未就绪 → 安装中 → 失败重试 → 就绪。
 *
 * 这是插件里最容易回归的地方——异步、多状态、按钮可用性随状态变化，而且用户第一次
 * 打开插件看到的就是它。断言按用户能看见的东西写（按钮文案、状态文案），不锁内部实现。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key, locale: "zh" }),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserActivityLog } from "../src/activity/log";
import { BrowserConsole, type BrowserConsolePorts } from "../src/components/BrowserConsole";
import { DEFAULT_BROWSER_SETTINGS } from "../src/config/settings";
import type { RuntimeStatus } from "../src/runtime/runtime-controller";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 只实现面板真正调用的那几个方法，避免把整个 controller 拖进 DOM 测试。 */
class FakeRuntime {
	private status: RuntimeStatus = { phase: "missing", chromeDetected: null, output: "" };
	private readonly listeners = new Set<(status: RuntimeStatus) => void>();
	installRuntimeCalls = 0;
	installBrowserCalls = 0;
	refreshCalls = 0;

	current(): RuntimeStatus {
		return this.status;
	}

	subscribe(listener: (status: RuntimeStatus) => void): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	set(patch: Partial<RuntimeStatus>): void {
		this.status = { ...this.status, ...patch };
		for (const listener of this.listeners) listener(this.status);
	}

	async installRuntime(): Promise<RuntimeStatus> {
		this.installRuntimeCalls++;
		return this.status;
	}

	async installBrowser(): Promise<RuntimeStatus> {
		this.installBrowserCalls++;
		return this.status;
	}

	async refresh(): Promise<RuntimeStatus> {
		this.refreshCalls++;
		return this.status;
	}
}

function renderConsole(overrides: Partial<BrowserConsolePorts> = {}): {
	host: HTMLElement;
	runtime: FakeRuntime;
	activity: BrowserActivityLog;
	cleanup: () => void;
} {
	const runtime = new FakeRuntime();
	const activity = new BrowserActivityLog();
	const ports: BrowserConsolePorts = {
		runtime: runtime as unknown as BrowserConsolePorts["runtime"],
		activity,
		readSettings: () => DEFAULT_BROWSER_SETTINGS,
		onSettingsChange: () => () => undefined,
		loadSessions: async () => ({ sessions: [] }),
		loadCredentials: async () => ({ credentials: [] }),
		deleteCredential: async () => undefined,
		activateTab: async () => undefined,
		clearSignInState: async () => undefined,
		...overrides,
	};
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	act(() => {
		root.render(<BrowserConsole ports={ports} />);
	});
	return {
		host,
		runtime,
		activity,
		cleanup: () => {
			act(() => root.unmount());
			host.remove();
		},
	};
}

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((button) => button.textContent === text);
}

describe("面板安装流程", () => {
	it("未就绪时给出安装入口与说明", () => {
		const { host, cleanup } = renderConsole();
		expect(host.textContent).toContain("console.status.missing");
		expect(host.textContent).toContain("console.installHint");
		expect(buttonWithText(host, "console.install")).toBeDefined();
		cleanup();
	});

	it("点击安装会触发安装，而不是只改个本地状态", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			buttonWithText(host, "console.install")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("安装中展示输出并禁用按钮，避免用户连点起第二个下载", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "installing", step: "runtime", output: "downloading 42%" });
		});
		expect(host.textContent).toContain("downloading 42%");
		expect(buttonWithText(host, "console.recheck")?.disabled).toBe(true);
		expect(buttonWithText(host, "console.install")).toBeUndefined();
		cleanup();
	});

	it("失败时显示原因与重试，重试再次触发安装", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "failed", step: "runtime", message: "npm 退出码 1", output: "npm ERR! network" });
		});
		expect(host.textContent).toContain("npm 退出码 1");
		expect(host.textContent).toContain("npm ERR! network");
		act(() => {
			buttonWithText(host, "console.retry")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("版本过旧时显示升级入口，而不是当作已就绪", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "outdated", version: "0.25.4" });
		});
		expect(host.textContent).toContain("console.status.outdated");
		act(() => {
			buttonWithText(host, "console.upgrade")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("版本过旧时不去查询会话 —— 那时任何 CLI 调用都会失败", () => {
		let calls = 0;
		const { runtime, cleanup } = renderConsole({
			loadSessions: async () => {
				calls++;
				return { sessions: [] };
			},
		});
		act(() => {
			runtime.set({ phase: "outdated", version: "0.25.4" });
		});
		expect(calls).toBe(0);
		cleanup();
	});

	it("就绪且本机已有 Chrome 时不再提示第二步下载", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "ready", version: "0.34.0", chromeDetected: true });
		});
		expect(host.textContent).toContain("console.chromeFound");
		expect(buttonWithText(host, "console.install")).toBeUndefined();
		cleanup();
	});

	it("就绪但没有 Chrome 时才出现下载浏览器这一步", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "ready", chromeDetected: false });
		});
		expect(host.textContent).toContain("console.chromeMissing");
		act(() => {
			buttonWithText(host, "console.install")?.click();
		});
		expect(runtime.installBrowserCalls).toBe(1);
		cleanup();
	});

	it("Chrome 状态判不出来时不擅自替用户下载", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "ready", chromeDetected: null });
		});
		expect(buttonWithText(host, "console.install")).toBeUndefined();
		cleanup();
	});
});

describe("面板数据加载", () => {
	it("未就绪时不去查询会话 —— 那时二进制都不在，只会刷一片红字", () => {
		let calls = 0;
		const { cleanup } = renderConsole({
			loadSessions: async () => {
				calls++;
				return { sessions: [] };
			},
		});
		expect(calls).toBe(0);
		cleanup();
	});

	it("被拦下的动作出现在操作日志里", () => {
		const { host, activity, cleanup } = renderConsole();
		act(() => {
			activity.record({
				tool: "agent_browser_open",
				target: "https://evil.com",
				outcome: "blocked",
				blockCode: "domain-not-allowed",
				reason: "不在白名单",
			});
		});
		expect(host.textContent).toContain("agent_browser_open");
		expect(host.textContent).toContain("console.log.blocked");
		cleanup();
	});

	it("附着模式给出共用浏览器的风险提示", () => {
		const { host, cleanup } = renderConsole({
			readSettings: () => ({ ...DEFAULT_BROWSER_SETTINGS, browserSource: "attach" }),
		});
		expect(host.textContent).toContain("console.policy.attachWarning");
		cleanup();
	});
});
