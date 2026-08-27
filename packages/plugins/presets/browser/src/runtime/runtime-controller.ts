import type { PluginBrowserApi, PluginBrowserRuntimeStatus } from "@vetta-org/plugin-sdk";

/**
 * 面板状态控制器。安装、版本校验和进程生命周期都归宿主 Foundation Capability；
 * 插件只把结构化状态转成可订阅的 UI 状态，不再拥有命令执行权限。
 */

/** 锁定版本：运行时是外部原生依赖，浮动版本会让「昨天还能用」变成随机故障。 */
export const AGENT_BROWSER_VERSION = "0.34.0";

/**
 * 插件依赖的不只是「有这个二进制」，还包括 `--config` 的配置键与 `--pin-tab` 这类开关。
 * 机器上常有用户自己装的旧版全局 agent-browser 抢在 PATH 前面，旧版会以 `Unknown command`
 * 立刻退出——模型只看到一条读不懂的报错。所以就绪判定必须比版本，而不只是「跑得起来」。
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

export type InstallStep = "runtime" | "browser";

export interface RuntimeStatus extends PluginBrowserRuntimeStatus {
	step?: InstallStep;
}

export interface RuntimeControllerPorts {
	browser: PluginBrowserApi;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class BrowserRuntimeController {
	private status: RuntimeStatus = { phase: "checking" };
	private readonly listeners = new Set<(status: RuntimeStatus) => void>();
	private disposed = false;
	private installing = false;

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

	async refresh(): Promise<RuntimeStatus> {
		if (this.installing) return this.status;
		this.emit({ phase: "checking", message: undefined, recentOutput: undefined, step: undefined });
		try {
			this.emit({ ...(await this.ports.browser.runtime.status()), step: undefined });
		} catch (error) {
			this.emit({ phase: "error", message: errorMessage(error), step: undefined });
		}
		return this.status;
	}

	/** 安装运行时本体。完成后顺带从输出里判断本机有没有系统 Chrome。 */
	async installRuntime(): Promise<RuntimeStatus> {
		return this.install("runtime");
	}

	/** 下载 Chrome for Testing。系统已有 Chrome 时不需要跑，由面板决定是否调用。 */
	async installBrowser(): Promise<RuntimeStatus> {
		return this.install("browser");
	}

	private async install(step: InstallStep): Promise<RuntimeStatus> {
		if (this.installing) return this.status;
		this.installing = true;
		this.emit({ phase: step === "runtime" ? "installing-runtime" : "installing-browser", step, message: undefined });
		try {
			this.emit({ ...(await this.ports.browser.runtime.install(step)), step });
		} catch (error) {
			this.emit({ phase: "error", step, message: errorMessage(error) });
		} finally {
			this.installing = false;
		}
		return this.status;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.listeners.clear();
	}
}
