import type { PluginCommandApi, PluginCommandSpawnHandle } from "@vetta-org/plugin-sdk";
import { detectSystemChrome } from "./parse";

/**
 * 运行时（agent-browser 二进制 + 浏览器）的就绪检测与安装编排。
 *
 * 两条硬约束决定了这里的形状：
 * - `command.run` 被宿主 clamp 在 120s，而 `npm i -g agent-browser` 要装 ~90MB、
 *   `agent-browser install` 要下几百 MB，两者都必然超时，所以安装只能走 `command.spawn`。
 * - `spawn` 句柄没有流式 stdout，只有 `status().recentOutput`（约 64KB 环形尾部）与
 *   `onExit`，所以进度只能靠轮询快照，而不是订阅增量。
 */

/** 锁定版本：运行时是外部原生依赖，浮动版本会让「昨天还能用」变成随机故障。 */
export const AGENT_BROWSER_VERSION = "0.34.0";

/**
 * 插件依赖的不只是「有这个二进制」，还包括 `--config` 的配置键与 `--pin-tab` 这类开关。
 * 机器上常有用户自己装的旧版全局 agent-browser 抢在 PATH 前面，旧版会以 `Unknown command`
 * 立刻退出——表现为工具面整个消失且毫无提示。所以就绪判定必须比版本，而不只是「跑得起来」。
 */
export const MINIMUM_AGENT_BROWSER_VERSION = AGENT_BROWSER_VERSION;

/** 从 `agent-browser --version` 输出里取版本号。 */
export function parseAgentBrowserVersion(output: string): string | null {
	return output.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null;
}

/** 版本解析不出来时 fail-closed 判为不兼容：宁可提示重装，也不要静默失败。 */
export function isAgentBrowserCompatible(version: string | null, minimum = MINIMUM_AGENT_BROWSER_VERSION): boolean {
	const parse = (value: string): number[] | null => {
		const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
		return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
	};
	const actual = version === null ? null : parse(version);
	const required = parse(minimum);
	if (!actual || !required) return false;
	for (let index = 0; index < 3; index++) {
		if (actual[index] > required[index]) return true;
		if (actual[index] < required[index]) return false;
	}
	return true;
}

export type RuntimePhase = "checking" | "missing" | "outdated" | "installing" | "ready" | "failed";
export type InstallStep = "runtime" | "browser";

export interface RuntimeStatus {
	phase: RuntimePhase;
	/** installing / failed 时指明是哪一步。 */
	step?: InstallStep;
	/** ready / outdated 时 agent-browser 自报的版本号。 */
	version?: string;
	/**
	 * 本机是否已有系统 Chrome。null = 判不出来（上游文案变了或没跑过安装），
	 * 此时面板把「下载浏览器」交给用户决定，而不是替他拉几百 MB。
	 */
	chromeDetected: boolean | null;
	/** 安装进程的输出尾部，用于展示进度与失败原因。 */
	output: string;
	/** failed 时面向用户的一句话原因。 */
	message?: string;
}

export interface RuntimeControllerPorts {
	command: PluginCommandApi;
	/** 轮询间隔的等待函数；测试注入假时钟。 */
	wait: (ms: number) => Promise<void>;
}

const POLL_INTERVAL_MS = 700;
const VERSION_TIMEOUT_MS = 20_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class BrowserRuntimeController {
	private status: RuntimeStatus = { phase: "checking", chromeDetected: null, output: "" };
	private readonly listeners = new Set<(status: RuntimeStatus) => void>();
	private running: PluginCommandSpawnHandle | null = null;
	private disposed = false;

	constructor(private readonly ports: RuntimeControllerPorts) {}

	current(): RuntimeStatus {
		return this.status;
	}

	subscribe(listener: (status: RuntimeStatus) => void): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	private emit(patch: Partial<RuntimeStatus>): void {
		if (this.disposed) return;
		this.status = { ...this.status, ...patch };
		for (const listener of this.listeners) listener(this.status);
	}

	/**
	 * 就绪检测。`command.run` 在可执行文件不存在时是 **reject**（spawn 失败），
	 * 非零退出才 resolve —— 两条路都当成「未安装」，但只有后者留得下诊断输出。
	 */
	async refresh(): Promise<RuntimeStatus> {
		this.emit({ phase: "checking", message: undefined });
		try {
			const result = await this.ports.command.run("agent-browser", ["--version"], {
				timeoutMs: VERSION_TIMEOUT_MS,
			});
			if (result.exitCode === 0) {
				const version = parseAgentBrowserVersion(result.stdout);
				this.emit(
					isAgentBrowserCompatible(version)
						? { phase: "ready", version: version ?? undefined, step: undefined, message: undefined }
						: { phase: "outdated", version: version ?? undefined, step: undefined, message: undefined },
				);
			} else {
				this.emit({ phase: "missing", step: undefined, output: result.stderr || result.stdout });
			}
		} catch {
			this.emit({ phase: "missing", step: undefined });
		}
		return this.status;
	}

	/** 安装运行时本体。完成后顺带从输出里判断本机有没有系统 Chrome。 */
	async installRuntime(): Promise<RuntimeStatus> {
		const output = await this.runInstallStep("runtime", "npm", [
			"i",
			"-g",
			`agent-browser@${AGENT_BROWSER_VERSION}`,
			// 上游 engines 要求 node>=24，而宿主托管的是 node 22。JS 入口只是个原生二进制的
			// 启动器，在 22 上跑得动；显式关掉严格检查，免得用户 npmrc 里开了 engine-strict 就装不上。
			"--engine-strict=false",
		]);
		if (output === null) return this.status;
		this.emit({ chromeDetected: detectSystemChrome(output) });
		return this.refresh();
	}

	/** 下载 Chrome for Testing。系统已有 Chrome 时不需要跑，由面板决定是否调用。 */
	async installBrowser(): Promise<RuntimeStatus> {
		const output = await this.runInstallStep("browser", "agent-browser", ["install"]);
		if (output === null) return this.status;
		return this.refresh();
	}

	/** 返回成功时的完整输出；失败时返回 null 并已把状态置为 failed。 */
	private async runInstallStep(step: InstallStep, file: string, args: string[]): Promise<string | null> {
		if (this.running !== null) return null;
		this.emit({ phase: "installing", step, output: "", message: undefined });
		let handle: PluginCommandSpawnHandle;
		try {
			handle = await this.ports.command.spawn(file, args);
		} catch (error) {
			this.emit({ phase: "failed", step, message: errorMessage(error) });
			return null;
		}
		this.running = handle;
		try {
			const status = await this.pollUntilExit(handle);
			if (status.exit && status.exit.exitCode !== 0) {
				this.emit({
					phase: "failed",
					step,
					output: status.recentOutput,
					message: `${file} ${args[0] ?? ""} 退出码 ${status.exit.exitCode ?? "signal"}`,
				});
				return null;
			}
			return status.recentOutput;
		} catch (error) {
			this.emit({ phase: "failed", step, message: errorMessage(error) });
			return null;
		} finally {
			this.running = null;
		}
	}

	private async pollUntilExit(
		handle: PluginCommandSpawnHandle,
	): Promise<Awaited<ReturnType<PluginCommandSpawnHandle["status"]>>> {
		for (;;) {
			const status = await handle.status();
			this.emit({ output: status.recentOutput });
			if (!status.running) return status;
			if (this.disposed) {
				await handle.stop();
				return status;
			}
			await this.ports.wait(POLL_INTERVAL_MS);
		}
	}

	/** 卸载：正在跑的安装进程要停掉，否则插件重载后会留下孤儿下载。 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.listeners.clear();
		const handle = this.running;
		this.running = null;
		if (handle) await handle.stop().catch(() => undefined);
	}
}
