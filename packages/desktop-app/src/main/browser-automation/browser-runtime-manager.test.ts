import { describe, expect, it, vi } from "vitest";
import type { BrowserProcessRunner } from "./browser-process-runner.js";
import { AGENT_BROWSER_VERSION, BrowserRuntimeManager } from "./browser-runtime-manager.js";

function makeRunner(output: string, exitCode = 0): BrowserProcessRunner {
	return {
		run: vi.fn().mockResolvedValue({
			exitCode,
			stdout: output,
			stderr: "",
			durationMs: 0,
			truncated: false,
		}),
	};
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("BrowserRuntimeManager", () => {
	it("returns ready when version matches minimum", async () => {
		const manager = new BrowserRuntimeManager(makeRunner("agent-browser 0.34.0"), logger);
		const status = await manager.status();
		expect(status.phase).toBe("ready");
		expect(status.version).toBe("0.34.0");
	});

	it("returns outdated when version below minimum", async () => {
		const manager = new BrowserRuntimeManager(makeRunner("agent-browser 0.28.0"), logger);
		const status = await manager.status();
		expect(status.phase).toBe("outdated");
		expect(status.version).toBe("0.28.0");
	});

	it("returns missing when spawn fails", async () => {
		const manager = new BrowserRuntimeManager({ run: vi.fn().mockRejectedValue(new Error("ENOENT")) }, logger);
		const status = await manager.status();
		expect(status.phase).toBe("missing");
	});

	it("npm install builds correct args", async () => {
		const runner = makeRunner("added 1 package");
		const manager = new BrowserRuntimeManager(runner, logger);
		await manager.install({ step: "runtime", namespace: "ns" });
		expect(runner.run).toHaveBeenCalledWith(
			"npm",
			["install", "--global", `agent-browser@${AGENT_BROWSER_VERSION}`, "--engine-strict=false"],
			expect.objectContaining({ timeoutMs: 15 * 60_000 }),
		);
	});

	it("agent-browser install builds correct args", async () => {
		const runner = makeRunner("Chrome ready");
		const manager = new BrowserRuntimeManager(runner, logger);
		await manager.install({ step: "browser", namespace: "ns" });
		expect(runner.run).toHaveBeenCalledWith(
			"agent-browser",
			["install"],
			expect.objectContaining({ timeoutMs: 10 * 60_000 }),
		);
	});

	it("install promises are deduplicated", async () => {
		// 同一个 manager 实例，连续两次 install 调用，第二次必须命中已存在的 installPromise
		// （installPromise 在第一次调用时同步赋值，第二次返回同一个引用）
		const runner = {
			async run() {
				return { exitCode: 0, stdout: "done", stderr: "", durationMs: 50, truncated: false };
			},
		};
		const manager = new BrowserRuntimeManager(runner as unknown as BrowserProcessRunner, logger);
		const a = manager.install({ step: "runtime", namespace: "ns" });
		const b = manager.install({ step: "runtime", namespace: "ns" });
		// 关键断言：a 和 b 必须是同一个 Promise 引用（证明 dedup 命中）
		expect(b).toBe(a);
		await Promise.all([a, b]);
	});
});
