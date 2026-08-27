/**
 * 工作区视图：一页使用说明 + 唯一的功能区（运行时状态与安装向导）。
 *
 * 测的是用户真正看得见的东西：运行时的五种状态各自给出哪个入口、示例 prompt 能不能复制、
 * 上游出处有没有写在页面上。断言按可见文案与按钮写，不锁 DOM 结构。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		// 直接回 key，好让断言锁住「显示了哪条文案」而不是具体译文；带参的补出参数值，
		// 这样「检测到 0.25.4」这种关键信息仍然可断言。
		t: (key: string, params?: Record<string, string | number>) =>
			params ? `${key}(${Object.values(params).join(",")})` : key,
		locale: "zh",
	}),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import {
	BrowserConsole,
	type BrowserConsolePorts,
	PLUGIN_ICON_URL,
	UPSTREAM_REPO_URL,
} from "../src/components/BrowserConsole";
import type { RuntimeStatus } from "../src/runtime/runtime-controller";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 只实现面板真正调用的那几个方法，避免把整个 controller 拖进 DOM 测试。 */
class FakeRuntime {
	private status: RuntimeStatus = { phase: "missing" };
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
	opened: string[];
	cleanup: () => void;
} {
	const runtime = new FakeRuntime();
	const opened: string[] = [];
	const ports: BrowserConsolePorts = {
		runtime: runtime as unknown as BrowserConsolePorts["runtime"],
		openExternal: (url) => opened.push(url),
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
		opened,
		cleanup: () => {
			act(() => root.unmount());
			host.remove();
		},
	};
}

function buttonWithText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((button) => button.textContent === text);
}

describe("页头图标", () => {
	it("走 vetta-plugin:// 协议，而不是打包器生成的资源路径", () => {
		// 回归：`import icon from "../../icon.png"` 在 dev 链接下会变成插件 dev server 上的
		// 路径 URL，但 remote 跑在宿主页面里、按宿主 origin 解析，开发态图标直接 404 空白。
		const { host, cleanup } = renderConsole();
		const img = host.querySelector("img");
		expect(img?.getAttribute("src")).toBe(PLUGIN_ICON_URL);
		expect(PLUGIN_ICON_URL.startsWith("vetta-plugin://")).toBe(true);
		cleanup();
	});
});

describe("上游出处", () => {
	it("页面上写明基于 agent-browser 与其许可证", () => {
		const { host, cleanup } = renderConsole();
		expect(host.textContent).toContain("hero.upstream");
		expect(host.textContent).toContain("hero.license");
		expect(host.textContent).toContain(UPSTREAM_REPO_URL);
		cleanup();
	});

	it("点击出处链接交给系统浏览器打开，而不是在应用内导航", () => {
		const { host, opened, cleanup } = renderConsole();
		act(() => {
			buttonWithText(host, "hero.openRepo")?.click();
		});
		expect(opened).toEqual([UPSTREAM_REPO_URL]);
		cleanup();
	});
});

describe("运行时状态", () => {
	it("未安装时给出安装入口与说明", () => {
		const { host, cleanup } = renderConsole();
		expect(host.textContent).toContain("console.status.missing");
		expect(host.textContent).toContain("console.installHint");
		expect(buttonWithText(host, "console.install")).toBeDefined();
		cleanup();
	});

	it("点击安装会真的触发安装，而不是只改本地状态", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			buttonWithText(host, "console.install")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("安装中展示输出并禁用按钮，避免连点起第二个下载", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "installing-runtime", step: "runtime", recentOutput: "downloading 42%" });
		});
		expect(host.textContent).toContain("downloading 42%");
		expect(buttonWithText(host, "console.recheck")?.disabled).toBe(true);
		expect(buttonWithText(host, "console.install")).toBeUndefined();
		cleanup();
	});

	it("失败时显示原因与重试", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "error", step: "runtime", message: "npm 退出码 1", recentOutput: "npm ERR! network" });
		});
		expect(host.textContent).toContain("npm 退出码 1");
		expect(host.textContent).toContain("npm ERR! network");
		act(() => {
			buttonWithText(host, "console.retry")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("版本过旧时显示升级入口，并把实际版本写进提示", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "outdated", version: "0.25.4" });
		});
		expect(host.textContent).toContain("console.status.outdated");
		expect(host.textContent).toContain("0.25.4");
		act(() => {
			buttonWithText(host, "console.upgrade")?.click();
		});
		expect(runtime.installRuntimeCalls).toBe(1);
		cleanup();
	});

	it("就绪且本机已有 Chrome 时不再提示第二步下载", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "ready", version: "0.34.0" });
		});
		expect(host.textContent).toContain("console.readyHint");
		expect(buttonWithText(host, "console.install")).toBeUndefined();
		cleanup();
	});

	it("就绪但没有 Chrome 时才出现下载浏览器这一步", () => {
		const { host, runtime, cleanup } = renderConsole();
		act(() => {
			runtime.set({ phase: "browser-missing" });
		});
		expect(host.textContent).toContain("console.chromeMissing");
		act(() => {
			buttonWithText(host, "console.install")?.click();
		});
		expect(runtime.installBrowserCalls).toBe(1);
		cleanup();
	});

});

describe("使用说明", () => {
	it("四条能力说明与安全默认值都在页面上", () => {
		const { host, cleanup } = renderConsole();
		for (const key of [
			"guide.cap.navigate.title",
			"guide.cap.interact.title",
			"guide.cap.signin.title",
			"guide.cap.isolation.title",
			"guide.safety.untrusted",
			"guide.safety.noEval",
			"guide.vs.body",
			"guide.newSession",
		]) {
			expect(host.textContent).toContain(key);
		}
		cleanup();
	});

	it("点示例把整条 prompt 写进剪贴板，并给出已复制反馈", async () => {
		const written: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: (text: string) => {
					written.push(text);
					return Promise.resolve();
				},
			},
		});

		const { host, cleanup } = renderConsole();
		const prompt = buttonWithText(host, "guide.prompt.readguide.copy");
		expect(prompt).toBeDefined();
		await act(async () => {
			prompt?.click();
		});
		expect(written).toEqual(["guide.prompt.read"]);
		expect(host.textContent).toContain("guide.copied");
		cleanup();
	});

	it("剪贴板不可用时不抛错，页面保持原状", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: () => Promise.reject(new Error("denied")) },
		});
		const { host, cleanup } = renderConsole();
		await act(async () => {
			buttonWithText(host, "guide.prompt.readguide.copy")?.click();
		});
		expect(host.textContent).not.toContain("guide.copied");
		cleanup();
	});
});
