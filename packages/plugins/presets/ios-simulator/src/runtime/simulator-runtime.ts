import type { PluginCommandApi, PluginCommandSpawnHandle } from "@vetta-org/plugin-sdk";
import { isBaguetteCompatible, MINIMUM_BAGUETTE_VERSION, parseBaguetteVersion } from "./baguette-version.js";
import { isBooted, parseDeviceList, type SimulatorDevice } from "./device-registry.js";

/**
 * 面板的运行时状态机：探测 baguette 并托管它的 serve 进程。
 *
 * 设备列表、开关机和所有设备操作都归 baguette 自带的 Web UI（见 serve-url），
 * 这里刻意不重复实现——插件只负责「运行时可不可用」和「服务在不在」。
 *
 * 进程生命周期归宿主：spawn 走独立进程组，插件禁用/卸载/退出时统一回收。
 */

export type RuntimePhase = "unsupported" | "checking" | "missing" | "outdated" | "ready" | "error";

export interface RuntimeState {
	readonly phase: RuntimePhase;
	readonly version?: string;
	readonly message?: string;
	/** serve 正在监听的端口；未启动时为 undefined。 */
	readonly serverPort?: number;
	readonly devices: readonly SimulatorDevice[];
	/** 正在启动的设备 udid；用于面板显示「正在启动…」。 */
	readonly bootingUdid?: string;
}

export interface RuntimePorts {
	readonly command: PluginCommandApi;
	readonly platform: string;
}

const COMMAND_TIMEOUT_MS = 20_000;
/** boot 要等 CoreSimulator 起完整个系统，比普通命令慢得多。 */
const BOOT_TIMEOUT_MS = 120_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class SimulatorRuntimeController {
	private state: RuntimeState = { phase: "checking", devices: [] };
	private readonly listeners = new Set<(state: RuntimeState) => void>();
	private disposed = false;
	private serverHandle: PluginCommandSpawnHandle | null = null;
	private serverStarting: Promise<number> | null = null;
	private refreshing: Promise<RuntimeState> | null = null;

	constructor(private readonly ports: RuntimePorts) {}

	current(): RuntimeState {
		return this.state;
	}

	subscribe(listener: (state: RuntimeState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private emit(patch: Partial<RuntimeState>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener(this.state);
	}

	/** 探测运行时。并发调用共享同一次执行。 */
	async refresh(): Promise<RuntimeState> {
		if (this.refreshing) return this.refreshing;
		this.refreshing = this.runRefresh().finally(() => {
			this.refreshing = null;
		});
		return this.refreshing;
	}

	private async runRefresh(): Promise<RuntimeState> {
		if (this.ports.platform !== "darwin") {
			this.emit({ phase: "unsupported", message: undefined });
			return this.state;
		}
		this.emit({ phase: "checking", message: undefined });
		let version: string | null;
		try {
			const result = await this.ports.command.run("baguette", ["--version"], { timeoutMs: COMMAND_TIMEOUT_MS });
			version = parseBaguetteVersion(`${result.stdout}\n${result.stderr}`);
		} catch {
			// 二进制不存在、未声明或被用户在插件设置里关掉，都按「没装」处理。
			this.emit({ phase: "missing", version: undefined });
			return this.state;
		}
		if (!isBaguetteCompatible(version)) {
			this.emit({ phase: "outdated", version: version ?? undefined });
			return this.state;
		}
		this.emit({ phase: "ready", version: version ?? undefined });
		await this.refreshDevices();
		return this.state;
	}

	async refreshDevices(): Promise<readonly SimulatorDevice[]> {
		try {
			const result = await this.ports.command.run("baguette", ["list"], { timeoutMs: COMMAND_TIMEOUT_MS });
			const devices = parseDeviceList(result.stdout);
			this.emit({ devices });
			return devices;
		} catch (error) {
			this.emit({ phase: "error", message: errorMessage(error) });
			return this.state.devices;
		}
	}

	/**
	 * 保证设备已启动。已经是 Booted 就直接返回，不重复 boot——用户可能正在用它。
	 * boot 之后刷新设备表，让面板拿到新的 state。
	 */
	async ensureBooted(device: SimulatorDevice): Promise<void> {
		if (isBooted(device)) return;
		this.emit({ bootingUdid: device.udid });
		try {
			await this.ports.command.run("baguette", ["boot", "--udid", device.udid], {
				timeoutMs: BOOT_TIMEOUT_MS,
			});
			await this.refreshDevices();
		} finally {
			this.emit({ bootingUdid: undefined });
		}
	}

	/** 保证 serve 在跑并返回端口。并发调用共享同一次启动。 */
	async ensureServer(): Promise<number> {
		if (this.serverHandle) {
			const status = await this.serverHandle.status();
			if (status.running && status.port !== undefined) return status.port;
			this.serverHandle = null;
		}
		if (this.serverStarting) return this.serverStarting;
		this.serverStarting = this.startServer().finally(() => {
			this.serverStarting = null;
		});
		return this.serverStarting;
	}

	private async startServer(): Promise<number> {
		// --host 保持缺省的 127.0.0.1：serve 不应该对局域网可见。
		const handle = await this.ports.command.spawn("baguette", ["serve", "--port", "{{PORT}}"], {
			allocatePort: true,
		});
		if (handle.port === undefined) {
			await handle.stop();
			throw new Error("host did not allocate a port for baguette serve");
		}
		this.serverHandle = handle;
		handle.onExit(() => {
			if (this.serverHandle !== handle) return;
			this.serverHandle = null;
			this.emit({ serverPort: undefined });
		});
		this.emit({ serverPort: handle.port });
		return handle.port;
	}

	/** 停掉当前 serve；下一次 ensureServer() 会重新拉起。 */
	async restartServer(): Promise<void> {
		const handle = this.serverHandle;
		this.serverHandle = null;
		this.emit({ serverPort: undefined });
		if (handle) await handle.stop().catch(() => undefined);
	}

	/** serve 起不来时把最近输出带出来——否则用户只看到一个空面板。 */
	async serverDiagnostics(): Promise<string | null> {
		if (!this.serverHandle) return null;
		try {
			return (await this.serverHandle.status()).recentOutput;
		} catch {
			return null;
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.listeners.clear();
		const handle = this.serverHandle;
		this.serverHandle = null;
		if (handle) await handle.stop().catch(() => undefined);
	}
}

export { errorMessage, MINIMUM_BAGUETTE_VERSION };
