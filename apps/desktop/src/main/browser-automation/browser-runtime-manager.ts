import type { BrowserRuntimeInstallInput, BrowserRuntimeStatus } from "@vetta/capability-sdk";
import type { BrowserProcessRunner } from "./browser-process-runner.js";
import type { BrowserAutomationLogger } from "./contracts.js";

export const AGENT_BROWSER_VERSION = "0.34.0";

function parseVersion(output: string): string | undefined {
	return /(?:agent-browser\s+)?(\d+\.\d+\.\d+)/i.exec(output)?.[1];
}

function compareVersion(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	for (let index = 0; index < 3; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

export class BrowserRuntimeManager {
	private installPromise?: Promise<BrowserRuntimeStatus>;
	private browserAvailable?: boolean;

	constructor(
		private readonly processRunner: BrowserProcessRunner,
		private readonly logger: BrowserAutomationLogger,
	) {}

	async status(signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		try {
			const result = await this.processRunner.run("agent-browser", ["--version"], {
				timeoutMs: 10_000,
				maxOutputChars: 8_000,
				signal,
			});
			if (result.exitCode !== 0) return { phase: "missing" };
			const version = parseVersion(`${result.stdout}\n${result.stderr}`);
			if (!version) return { phase: "error", message: "Unable to read browser runtime version" };
			if (compareVersion(version, AGENT_BROWSER_VERSION) < 0) return { phase: "outdated", version };
			return this.browserAvailable === false ? { phase: "browser-missing", version } : { phase: "ready", version };
		} catch (error) {
			if (signal?.aborted) throw error;
			this.logger.warn("browser runtime check failed", {
				errorKind: error instanceof Error ? error.name : "unknown",
			});
			return { phase: "missing" };
		}
	}

	install(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		if (this.installPromise) return this.installPromise;
		this.installPromise = this.runInstall(input, signal).finally(() => {
			this.installPromise = undefined;
		});
		return this.installPromise;
	}

	private async runInstall(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		const startedAt = Date.now();
		this.logger.info("browser runtime install started", { namespace: input.namespace, step: input.step });
		const file = input.step === "runtime" ? "npm" : "agent-browser";
		const args =
			input.step === "runtime"
				? ["install", "--global", `agent-browser@${AGENT_BROWSER_VERSION}`, "--engine-strict=false"]
				: ["install"];
		try {
			const result = await this.processRunner.run(file, args, {
				timeoutMs: 15 * 60_000,
				maxOutputChars: 64_000,
				signal,
			});
			if (result.exitCode !== 0) {
				this.logger.error("browser runtime install failed", {
					namespace: input.namespace,
					step: input.step,
					exitCode: result.exitCode,
					durationMs: Date.now() - startedAt,
				});
				return {
					phase: "error",
					message: `Browser ${input.step} installation failed`,
					recentOutput: result.stderr || result.stdout,
				};
			}
			if (input.step === "runtime") {
				this.browserAvailable = detectBrowserAvailability(`${result.stdout}\n${result.stderr}`);
			} else {
				this.browserAvailable = true;
			}
			const status = await this.status(signal);
			this.logger.info("browser runtime install completed", {
				namespace: input.namespace,
				step: input.step,
				durationMs: Date.now() - startedAt,
				phase: status.phase,
			});
			return { ...status, recentOutput: result.stdout || undefined };
		} catch (error) {
			if (signal?.aborted) {
				this.logger.info("browser runtime install cancelled", {
					namespace: input.namespace,
					step: input.step,
					durationMs: Date.now() - startedAt,
				});
				throw error;
			}
			this.logger.error("browser runtime install failed", {
				namespace: input.namespace,
				step: input.step,
				durationMs: Date.now() - startedAt,
				errorKind: error instanceof Error ? error.name : "unknown",
			});
			return { phase: "error", message: `Browser ${input.step} installation failed` };
		}
	}
}

function detectBrowserAvailability(output: string): boolean | undefined {
	if (/System Chrome found:/i.test(output)) return true;
	if (/No Chrome installation detected/i.test(output)) return false;
	return undefined;
}
