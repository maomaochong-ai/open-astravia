import type {
	PluginBrowserApi,
	PluginBrowserRuntimeStatus,
} from "@astravia-org/plugin-sdk";

/**
 * 面板状态控制器。安装、版本校验和进程生命周期都归宿主 Foundation Capability；
 * 插件只把结构化状态转成可订阅的 UI 状态，不再拥有命令执行权限。
 */

/** 锁定版本：运行时是外部原生依赖，浮动版本会让「昨天还能用」变成随机故障。 */
export const AGENT_BROWSER_VERSION = "0.34.0";
/** RuntimeSection 引用的最低版本常量 alias。 */
export const MINIMUM_AGENT_BROWSER_VERSION = AGENT_BROWSER_VERSION;

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

	async installRuntime(): Promise<RuntimeStatus> {
		return this.install("runtime");
	}

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
