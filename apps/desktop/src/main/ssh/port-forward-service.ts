import { createServer } from "node:net";
import { getAppLogger } from "../logger.js";
import { broadcastSshPortForwards } from "./ssh-events.js";
import { getSshConnection } from "./ssh-runtime.js";

const log = getAppLogger("ssh");

/** 谁要求建立这条转发。用户手动加的不会被自动清理，插件的随它的进程一起收掉。 */
export type PortForwardSource = "manual" | "detected" | "plugin";

/**
 * `active` 是本机端口上确实还有人在听；`reconnecting` 是正在重建；`failed` 之后**不再自动
 * 重试**——重建可能要用户输一次口令，循环重试会把口令弹窗变成骚扰。
 */
export type PortForwardStatus = "active" | "reconnecting" | "failed";

export interface PortForward {
	readonly hostId: string;
	readonly remotePort: number;
	readonly localPort: number;
	/** 用户可见的备注，通常是进程名。 */
	readonly label?: string;
	readonly source: PortForwardSource;
	readonly status: PortForwardStatus;
	/** status 为 failed 时的原因，原样来自 ssh。 */
	readonly error?: string;
	readonly createdAt: number;
}

export interface PortForwardRequest {
	readonly hostId: string;
	readonly remotePort: number;
	/** 指定本机端口。省略时优先用与远端同号的端口，被占用再退到随机端口。 */
	readonly localPort?: number;
	readonly label?: string;
	readonly source?: PortForwardSource;
}

/** 这个服务用到的连接能力。注入它使得服务本身不必碰真的 ssh。 */
export interface PortForwardConnection {
	forwardPort(localPort: number, remotePort: number): Promise<void>;
	cancelPortForward(localPort: number, remotePort: number): Promise<void>;
}

export interface SshPortForwardServiceOptions {
	readonly connect: (hostId: string) => PortForwardConnection;
	/** 本机端口上是否已经有人在听。 */
	readonly isLocalPortBusy?: (port: number) => Promise<boolean>;
	/** 由系统分配一个空闲的本机端口。 */
	readonly allocateLocalPort?: () => Promise<number>;
	readonly onChanged?: () => void;
	/** 健康巡检间隔；只在存在转发时运行。 */
	readonly healthIntervalMs?: number;
}

const DEFAULT_HEALTH_INTERVAL_MS = 5_000;

/**
 * 进程内所有远端端口转发的账本。
 *
 * 转发本身是 OpenSSH 的能力（`ssh -O forward`，挂在已建立的 ControlMaster 上），这一层管的是
 * 它没管的三件事：
 *
 * 1. **谁转了什么**。转发一旦建立就只是一个本机监听端口，从它反查不出远端端口、也不知道
 *    是界面、插件还是模型要的。没有账本，界面就没法把「已转发」列出来，更没法撤。
 * 2. **本机端口怎么挑**。界面只能连本机端口，而远端那个号在本机可能已经被占；优先同号是
 *    因为前端框架常把端口号写进 HMR 与绝对 URL 里，号一变就有一部分功能悄悄失效。
 * 3. **转发会静默消失**。它随 ControlMaster 一起活着，而 master 在空闲 `ControlPersist`
 *    之后、或网络断开时会退出。届时本机端口上没人再听，浏览器只会得到一次 connection
 *    reset——完全看不出原因。巡检负责把这件事变成界面上的一行状态。
 *
 * 刻意不做持久化：转发依附于本进程起的 ssh master，应用一退全部消失，把它写进配置只会在
 * 下次启动时得到一份指向不存在的转发的清单。
 */
export class SshPortForwardService {
	private readonly forwards = new Map<string, PortForward>();
	private timer: NodeJS.Timeout | undefined;
	private verifying = false;

	constructor(private readonly options: SshPortForwardServiceOptions) {}

	list(hostId?: string): PortForward[] {
		const all = [...this.forwards.values()];
		const scoped = hostId === undefined ? all : all.filter((forward) => forward.hostId === hostId);
		return scoped.sort((left, right) => left.remotePort - right.remotePort);
	}

	/**
	 * 建立一条转发，返回它最终用上的本机端口。
	 *
	 * 同一台主机的同一个远端端口重复请求时复用已有的那条：调用方可能是界面、插件和模型三处，
	 * 各自都以为自己是第一个；重复建立会让后来者撤掉前面那条正在被用的转发。例外是显式点名了
	 * 另一个本机端口——那是「换个号」，见 {@link remap}。
	 */
	async open(request: PortForwardRequest): Promise<PortForward> {
		const remotePort = assertPort(request.remotePort, "remote port");
		const key = forwardKey(request.hostId, remotePort);
		const existing = this.forwards.get(key);
		if (existing && existing.status !== "failed") {
			if (request.localPort === undefined || request.localPort === existing.localPort) return existing;
			return this.remap(existing, assertPort(request.localPort, "local port"));
		}

		const localPort =
			request.localPort === undefined
				? await this.pickLocalPort(remotePort)
				: await this.claimLocalPort(assertPort(request.localPort, "local port"));
		const forward: PortForward = {
			hostId: request.hostId,
			remotePort,
			localPort,
			label: request.label,
			source: request.source ?? "manual",
			status: "active",
			createdAt: Date.now(),
		};
		await this.options.connect(request.hostId).forwardPort(localPort, remotePort);
		this.forwards.set(key, forward);
		this.startHealthChecks();
		this.changed();
		return forward;
	}

	/**
	 * 把一条已有的转发换到另一个本机端口上。
	 *
	 * 顺序是「先占新的、再接通、最后撤旧的」：新端口被占用或接不通时，用户原来那条还在正常
	 * 工作。反过来先撤再建，一旦新端口不可用，用户就在一次「改个号」里把能用的转发弄丢了。
	 */
	private async remap(existing: PortForward, localPort: number): Promise<PortForward> {
		await this.claimLocalPort(localPort);
		const connection = this.options.connect(existing.hostId);
		await connection.forwardPort(localPort, existing.remotePort);
		const next: PortForward = { ...existing, localPort, status: "active", error: undefined };
		this.forwards.set(forwardKey(existing.hostId, existing.remotePort), next);
		this.changed();
		await connection.cancelPortForward(existing.localPort, existing.remotePort).catch(() => undefined);
		return next;
	}

	/** 撤掉一条转发。不存在时什么都不做——调用方不必先查一遍。 */
	async close(hostId: string, remotePort: number): Promise<void> {
		const key = forwardKey(hostId, remotePort);
		const forward = this.forwards.get(key);
		if (!forward) return;
		this.forwards.delete(key);
		this.stopHealthChecksWhenIdle();
		this.changed();
		// 撤不掉不该拖累调用方：转发会随 master 一起消失，而账本已经清了。
		await this.options
			.connect(hostId)
			.cancelPortForward(forward.localPort, forward.remotePort)
			.catch(() => undefined);
	}

	/** 主机被删除或断开时收掉它的全部转发。 */
	async closeHost(hostId: string): Promise<void> {
		for (const forward of this.list(hostId)) await this.close(hostId, forward.remotePort);
	}

	/**
	 * 巡检一遍：本机端口上没人听的转发已经没了，尝试重建一次。
	 *
	 * 判据用「能不能把这个端口 bind 下来」而不是去连它：连上去会真的在远端开一条连接，
	 * 在远端日志里留下一串无人解释的空连接。bind 成功恰恰说明没人在听。
	 */
	async verify(): Promise<void> {
		if (this.verifying) return;
		this.verifying = true;
		try {
			for (const forward of this.list()) {
				if (forward.status !== "active") continue;
				if (await this.isLocalPortBusy(forward.localPort)) continue;
				await this.reestablish(forward);
			}
		} finally {
			this.verifying = false;
		}
	}

	/** 应用退出时停掉巡检。转发本身随 ssh master 消失，不必逐条撤。 */
	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.forwards.clear();
	}

	private async reestablish(forward: PortForward): Promise<void> {
		const key = forwardKey(forward.hostId, forward.remotePort);
		// 巡检是在一份快照上逐条做的，探测本机端口的那次等待里用户可能已经把这条撤了。条目
		// 是不可变对象，比对身份即可认出「还是我要重建的那一条」——否则重建会把它复活。
		if (this.forwards.get(key) !== forward) return;
		this.forwards.set(key, { ...forward, status: "reconnecting", error: undefined });
		this.changed();
		try {
			await this.options.connect(forward.hostId).forwardPort(forward.localPort, forward.remotePort);
			// 期间用户可能已经撤掉了它；那时不要把它复活。
			if (!this.forwards.has(key)) return;
			this.forwards.set(key, { ...forward, status: "active", error: undefined });
		} catch (error) {
			if (!this.forwards.has(key)) return;
			const message = error instanceof Error ? error.message : String(error);
			log.warn(`could not re-establish the forward for remote port ${forward.remotePort}: ${message}`);
			this.forwards.set(key, { ...forward, status: "failed", error: message });
		}
		this.changed();
	}

	private async pickLocalPort(remotePort: number): Promise<number> {
		if (!(await this.isLocalPortBusy(remotePort))) return remotePort;
		return this.allocateLocalPort();
	}

	private async claimLocalPort(localPort: number): Promise<number> {
		// 用户点名了这个端口，占用时如实报错：偷偷换一个号会让他按着旧号去连。
		if (await this.isLocalPortBusy(localPort)) {
			throw new Error(`Local port ${localPort} is already in use.`);
		}
		return localPort;
	}

	private isLocalPortBusy(port: number): Promise<boolean> {
		return (this.options.isLocalPortBusy ?? isLocalPortBusy)(port);
	}

	private allocateLocalPort(): Promise<number> {
		return (this.options.allocateLocalPort ?? allocateLocalPort)();
	}

	private startHealthChecks(): void {
		if (this.timer || this.forwards.size === 0) return;
		this.timer = setInterval(
			() => void this.verify().catch(() => undefined),
			this.options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS,
		);
		this.timer.unref?.();
	}

	private stopHealthChecksWhenIdle(): void {
		if (this.forwards.size > 0 || !this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}

	private changed(): void {
		this.options.onChanged?.();
	}
}

function forwardKey(hostId: string, remotePort: number): string {
	return `${hostId}:${remotePort}`;
}

function assertPort(value: number, what: string): number {
	if (!Number.isInteger(value) || value <= 0 || value > 65535) {
		throw new Error(`Invalid ${what}: ${value}. It must be an integer between 1 and 65535.`);
	}
	return value;
}

/**
 * 本机这个端口上是否已经有人在听。
 *
 * 只探 `127.0.0.1`：`ssh -L` 在没有 `GatewayPorts` 时也只绑回环，探别的地址会把「另一张
 * 网卡上有个服务」误判成冲突。
 */
function isLocalPortBusy(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(true));
		server.listen(port, "127.0.0.1", () => server.close(() => resolve(false)));
	});
}

function allocateLocalPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close(() => reject(new Error("Could not allocate a local port.")));
				return;
			}
			server.close(() => resolve(address.port));
		});
	});
}

let instance: SshPortForwardService | undefined;

export function getSshPortForwardService(): SshPortForwardService {
	instance ??= new SshPortForwardService({
		connect: (hostId) => getSshConnection(hostId),
		onChanged: broadcastSshPortForwards,
	});
	return instance;
}
