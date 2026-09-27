import type { BrowserAction } from "@astravia/capability-sdk";
import type { BrowserProcessRunner } from "./browser-process-runner.js";
import type { BrowserEngine, BrowserEnginePageResult, BrowserEngineSession } from "./contracts.js";

const BROWSER_ACTION_TIMEOUT_MS = 120_000;

function buildActionSubcommand(action: BrowserAction): string[] {
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
			return ["check", ...(action.target ? [action.target] : []), action.checked ? "--checked" : "--unchecked"];
		case "press":
			return ["press", action.key];
		case "scroll": {
			const args = ["scroll", action.direction];
			if (action.amount !== undefined) args.push(String(action.amount));
			return args;
		}
		case "wait": {
			const args = ["wait"];
			if (action.target) args.push("--selector", action.target);
			if (action.milliseconds !== undefined) args.push("--ms", String(action.milliseconds));
			return args;
		}
		case "back":
			return ["back"];
		case "reload":
			return ["reload"];
		default: {
			const _exhaustive: never = action;
			throw new Error(`Unknown browser action type: ${(_exhaustive as { type: string }).type}`);
		}
	}
}

export class AgentBrowserEngine implements BrowserEngine {
	constructor(private readonly processRunner: BrowserProcessRunner) {}

	async navigate(session: BrowserEngineSession, url: string, signal?: AbortSignal): Promise<BrowserEnginePageResult> {
		return this.execute(session, ["navigate", url], signal);
	}

	async snapshot(
		session: BrowserEngineSession,
		interactiveOnly: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult> {
		const args = ["snapshot"];
		if (interactiveOnly) args.push("--interactive");
		return this.execute(session, args, signal);
	}

	async readText(session: BrowserEngineSession, signal?: AbortSignal): Promise<BrowserEnginePageResult> {
		return this.execute(session, ["get", "text"], signal);
	}

	async screenshot(
		session: BrowserEngineSession,
		fullPage: boolean,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult & { dataUrl: string }> {
		const args = ["screenshot"];
		if (fullPage) args.push("--full");
		const result = await this.execute(session, args, signal);
		// agent-browser screenshot 默认输出 stdout 为 data URL
		return { ...result, dataUrl: result.output ?? "" };
	}

	async act(
		session: BrowserEngineSession,
		action: BrowserAction,
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult> {
		return this.execute(session, buildActionSubcommand(action), signal);
	}

	async close(session: BrowserEngineSession, signal?: AbortSignal): Promise<void> {
		try {
			await this.execute(session, ["close"], signal);
		} catch {
			// best effort: 关闭失败不应阻塞清理
		}
	}

	private async execute(
		session: BrowserEngineSession,
		command: string[],
		signal?: AbortSignal,
	): Promise<BrowserEnginePageResult> {
		const args = ["--config", session.configPath, "--session", session.id, "--pin-tab", ...command];
		const result = await this.processRunner.run("agent-browser", args, {
			timeoutMs: BROWSER_ACTION_TIMEOUT_MS,
			maxOutputChars: 1_000_000,
			signal,
		});
		if (result.exitCode !== 0) {
			throw new Error(`agent-browser command failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
		}
		// 拿真实 url + title：agent-browser 每条命令都在同一个 daemon session 上，
		// 所以 follow-up 的 get url / get title 总能读到当前页面状态。
		// close 命令本身关闭 session 后继无意义，跳过 follow-up。
		if (command[0] !== "close") {
			try {
				const [urlResult, titleResult] = await Promise.all([
					this.processRunner.run(
						"agent-browser",
						["--config", session.configPath, "--session", session.id, "get", "url"],
						{ timeoutMs: BROWSER_ACTION_TIMEOUT_MS, signal },
					),
					this.processRunner.run(
						"agent-browser",
						["--config", session.configPath, "--session", session.id, "get", "title"],
						{ timeoutMs: BROWSER_ACTION_TIMEOUT_MS, signal },
					),
				]);
				return {
					url: urlResult.exitCode === 0 ? urlResult.stdout.trim() : "",
					title: titleResult.exitCode === 0 ? titleResult.stdout.trim() : "",
					output: result.stdout.trim(),
				};
			} catch {
				// follow-up 失败不应让原操作失败（原操作已成功执行）
				return { url: "", title: "", output: result.stdout.trim() };
			}
		}
		return { url: "", title: "", output: result.stdout.trim() };
	}
}
