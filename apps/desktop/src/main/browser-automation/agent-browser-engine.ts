import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserAction } from "@vetta/capability-sdk";
import {
	BrowserProcessAbortedError,
	type BrowserProcessResult,
	type BrowserProcessRunner,
} from "./browser-process-runner.js";
import type { BrowserEngine, BrowserEnginePageResult, BrowserEngineSession } from "./contracts.js";
import { BrowserAutomationError } from "./contracts.js";

const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;

function actionArguments(action: BrowserAction): string[] {
	switch (action.type) {
		case "click":
			return ["click", action.target];
		case "fill":
			return ["fill", action.target, action.value];
		case "type":
			return ["type", action.target, action.value];
		case "select":
			return ["select", action.target, action.value];
		case "check":
			return [action.checked ? "check" : "uncheck", action.target];
		case "press":
			return ["press", action.key];
		case "scroll":
			return ["scroll", action.direction, ...(action.amount === undefined ? [] : [String(action.amount)])];
		case "wait": {
			const value = action.target ?? (action.milliseconds === undefined ? undefined : String(action.milliseconds));
			if (value === undefined) {
				throw new BrowserAutomationError("invalid_request", "Wait action requires target or milliseconds");
			}
			return ["wait", value];
		}
		case "back":
			return ["back"];
		case "reload":
			return ["reload"];
	}
}

export class AgentBrowserEngine implements BrowserEngine {
	constructor(private readonly processRunner: BrowserProcessRunner) {}

	async navigate(session: BrowserEngineSession, url: string, signal?: AbortSignal): Promise<BrowserEnginePageResult> {
		const output = await this.execute(session, ["open", url], signal);
		return { ...(await this.currentPage(session, signal)), output };
	}

	async snapshot(
		session: BrowserEngineSession,
		interactiveOnly: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult> {
		const output = await this.execute(session, ["snapshot", ...(interactiveOnly ? ["-i"] : [])], signal);
		return { ...(await this.currentPage(session, signal)), output };
	}

	async readText(session: BrowserEngineSession, signal?: AbortSignal): Promise<BrowserEnginePageResult> {
		const output = await this.execute(session, ["get", "text", "body"], signal);
		return { ...(await this.currentPage(session, signal)), output };
	}

	async screenshot(
		session: BrowserEngineSession,
		fullPage: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult & { dataUrl: string }> {
		const directory = await mkdtemp(join(tmpdir(), "vetta-browser-shot-"));
		const screenshotPath = join(directory, "page.png");
		try {
			await this.execute(session, ["screenshot", screenshotPath, ...(fullPage ? ["--full-page"] : [])], signal);
			const file = await stat(screenshotPath);
			if (file.size > MAX_SCREENSHOT_BYTES) {
				throw new BrowserAutomationError("output_too_large", "Browser screenshot exceeds 16 MiB");
			}
			const data = await readFile(screenshotPath);
			return {
				...(await this.currentPage(session, signal)),
				dataUrl: `data:image/png;base64,${data.toString("base64")}`,
			};
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}

	async act(
		session: BrowserEngineSession,
		action: BrowserAction,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult> {
		const output = await this.execute(session, actionArguments(action), signal);
		return { ...(await this.currentPage(session, signal)), output };
	}

	async close(session: BrowserEngineSession, signal?: AbortSignal): Promise<void> {
		await this.execute(session, ["close"], signal);
	}

	private async currentPage(session: BrowserEngineSession, signal?: AbortSignal): Promise<BrowserEnginePageResult> {
		const url = (await this.execute(session, ["get", "url"], signal)).trim();
		const title = (await this.execute(session, ["get", "title"], signal)).trim();
		return { url: url || "about:blank", title: title || undefined };
	}

	private async execute(
		session: BrowserEngineSession,
		command: readonly string[],
		signal?: AbortSignal,
	): Promise<string> {
		let result: BrowserProcessResult;
		try {
			result = await this.processRunner.run(
				"agent-browser",
				["--config", session.configPath, "--session", session.id, "--pin-tab", ...command],
				{ timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS, signal },
			);
		} catch (error) {
			if (error instanceof BrowserProcessAbortedError) throw error;
			throw new BrowserAutomationError("engine_failed", "Browser engine failed to start", { cause: error });
		}
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim().slice(-2_000);
			throw new BrowserAutomationError(
				"engine_failed",
				detail ? `Browser engine command failed: ${detail}` : "Browser engine command failed",
			);
		}
		return result.stdout;
	}
}
