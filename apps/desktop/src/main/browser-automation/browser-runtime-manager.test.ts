import { describe, expect, it, vi } from "vitest";
import type { BrowserProcessRunner } from "./browser-process-runner.js";
import { AGENT_BROWSER_VERSION, BrowserRuntimeManager } from "./browser-runtime-manager.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("BrowserRuntimeManager", () => {
	it("distinguishes missing, outdated, and ready runtimes", async () => {
		const outputs = [
			{ exitCode: 1, stdout: "", stderr: "missing", durationMs: 1, truncated: false },
			{ exitCode: 0, stdout: "agent-browser 0.25.4", stderr: "", durationMs: 1, truncated: false },
			{ exitCode: 0, stdout: `agent-browser ${AGENT_BROWSER_VERSION}`, stderr: "", durationMs: 1, truncated: false },
		];
		const runner: BrowserProcessRunner = { run: vi.fn(async () => outputs.shift()!) };
		const manager = new BrowserRuntimeManager(runner, logger);
		expect(await manager.status()).toEqual({ phase: "missing" });
		expect(await manager.status()).toEqual({ phase: "outdated", version: "0.25.4" });
		expect(await manager.status()).toEqual({ phase: "ready", version: AGENT_BROWSER_VERSION });
	});

	it("deduplicates concurrent runtime installations", async () => {
		let releaseInstall: (() => void) | undefined;
		const runner: BrowserProcessRunner = {
			run: vi.fn(async (file) => {
				if (file === "npm") {
					await new Promise<void>((resolve) => {
						releaseInstall = resolve;
					});
				}
				return {
					exitCode: 0,
					stdout: file === "npm" ? "installed" : `agent-browser ${AGENT_BROWSER_VERSION}`,
					stderr: "",
					durationMs: 1,
					truncated: false,
				};
			}),
		};
		const manager = new BrowserRuntimeManager(runner, logger);
		const first = manager.install({ namespace: "plugin-a", step: "runtime" });
		const second = manager.install({ namespace: "plugin-b", step: "runtime" });
		expect(first).toBe(second);
		releaseInstall?.();
		await expect(first).resolves.toMatchObject({ phase: "ready" });
		expect(runner.run).toHaveBeenCalledTimes(2);
	});

	it("reports browser-missing after runtime install detects no Chrome, then ready after browser install", async () => {
		const runner: BrowserProcessRunner = {
			run: vi.fn(async (file, args) => ({
				exitCode: 0,
				stdout:
					file === "npm"
						? "No Chrome installation detected."
						: args[0] === "--version"
							? `agent-browser ${AGENT_BROWSER_VERSION}`
							: "browser installed",
				stderr: "",
				durationMs: 1,
				truncated: false,
			})),
		};
		const manager = new BrowserRuntimeManager(runner, logger);
		expect(await manager.install({ namespace: "browser", step: "runtime" })).toMatchObject({
			phase: "browser-missing",
		});
		expect(await manager.install({ namespace: "browser", step: "browser" })).toMatchObject({ phase: "ready" });
	});
});
