import type { PluginBrowserApi, PluginBrowserRuntimeStatus } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { BrowserRuntimeController } from "../src/runtime/runtime-controller";

function createBrowser(statuses: PluginBrowserRuntimeStatus[]): PluginBrowserApi {
	let cursor = 0;
	const next = async (): Promise<PluginBrowserRuntimeStatus> => statuses[Math.min(cursor++, statuses.length - 1)];
	return {
		runtime: { status: vi.fn(next), install: vi.fn(next) },
		sessions: { create: vi.fn(), get: vi.fn(), close: vi.fn() },
		navigate: vi.fn(),
		snapshot: vi.fn(),
		readText: vi.fn(),
		screenshot: vi.fn(),
		act: vi.fn(),
	};
}

describe("BrowserRuntimeController", () => {
	it("直接消费宿主的结构化状态，不再执行或解析命令", async () => {
		const browser = createBrowser([{ phase: "ready", version: "0.34.0" }]);
		const controller = new BrowserRuntimeController({ browser });
		expect(await controller.refresh()).toMatchObject({ phase: "ready", version: "0.34.0" });
	});

	it("运行时安装期间先发布 installing-runtime，再发布宿主结果", async () => {
		const browser = createBrowser([{ phase: "browser-missing", version: "0.34.0" }]);
		const controller = new BrowserRuntimeController({ browser });
		const phases: string[] = [];
		controller.subscribe((status) => phases.push(status.phase));
		await controller.installRuntime();
		expect(phases).toContain("installing-runtime");
		expect(controller.current().phase).toBe("browser-missing");
		expect(browser.runtime.install).toHaveBeenCalledWith("runtime");
	});

	it("浏览器安装使用 browser 步骤", async () => {
		const browser = createBrowser([{ phase: "ready", version: "0.34.0" }]);
		const controller = new BrowserRuntimeController({ browser });
		await controller.installBrowser();
		expect(browser.runtime.install).toHaveBeenCalledWith("browser");
	});

	it("宿主调用失败进入可诊断 error 状态", async () => {
		const browser = createBrowser([{ phase: "ready" }]);
		browser.runtime.status = vi.fn().mockRejectedValue(new Error("provider unavailable"));
		const controller = new BrowserRuntimeController({ browser });
		expect(await controller.refresh()).toMatchObject({ phase: "error", message: "provider unavailable" });
	});

	it("卸载后不再向旧订阅者推送", async () => {
		const controller = new BrowserRuntimeController({ browser: createBrowser([{ phase: "ready" }]) });
		let count = 0;
		controller.subscribe(() => count++);
		const before = count;
		await controller.dispose();
		await controller.refresh();
		expect(count).toBe(before);
	});
});
