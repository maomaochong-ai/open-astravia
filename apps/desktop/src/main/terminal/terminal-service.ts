import { randomUUID } from "node:crypto";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import {
	clampTerminalSize,
	type OpenTerminalRequest,
	type OpenTerminalResult,
	type TerminalCapabilities,
} from "../../shared/terminal-ipc.js";
import { createLocalPtyBackendFactory, probeLocalPty } from "./local-pty-backend.js";
import { createRemotePtyBackendFactory } from "./remote-pty-backend.js";
import type { OpenTerminalBackendOptions, TerminalBackend, TerminalBackendFactory } from "./terminal-backend.js";
import { TerminalSession } from "./terminal-session.js";

/**
 * 同时存在的终端上限。到顶时拒绝新建而不是回收最旧的：
 * 回收一个终端等于杀掉用户正在跑的进程。
 */
const MAX_SESSIONS = 24;

export interface RemoteTerminalOpenResult {
	readonly backend: TerminalBackend;
	/** 只能走 `ssh -tt` 降级（helper 不可用）：尺寸固定，界面要如实提示这个缺口。 */
	readonly degraded: boolean;
}

/**
 * 降级信息随每次 open 返回，而不是记在工厂上：两个终端并发打开时，
 * 工厂级的「上一次是否降级」会互相串味。
 */
export interface RemoteTerminalBackendFactory {
	open(options: OpenTerminalBackendOptions): Promise<RemoteTerminalOpenResult>;
}

export interface TerminalServiceOptions {
	readonly localFactory?: TerminalBackendFactory;
	readonly remoteFactory?: RemoteTerminalBackendFactory;
	readonly maxSessions?: number;
	readonly newId?: () => string;
	readonly probeLocal?: () => { available: boolean; reason?: string };
}

export class TerminalOpenError extends Error {}

/**
 * 终端会话表。业务都在这里，IPC 层只做参数校验与转发（见 `main/ipc/AGENTS.md`）。
 *
 * 会话按 owner（渲染进程的 webContents id）登记：渲染进程崩溃或重载时拿不到显式
 * close，只能靠 owner 维度整批回收，否则 PTY 会变成孤儿进程一直占着。
 */
export class TerminalService {
	private readonly sessions = new Map<string, { session: TerminalSession; ownerId: number }>();
	private readonly localFactory: TerminalBackendFactory;
	private readonly remoteFactory: RemoteTerminalBackendFactory;
	private readonly maxSessions: number;
	private readonly newId: () => string;
	private readonly probeLocalPtyFn: () => { available: boolean; reason?: string };

	constructor(options: TerminalServiceOptions = {}) {
		this.localFactory = options.localFactory ?? createLocalPtyBackendFactory();
		this.remoteFactory = options.remoteFactory ?? createRemotePtyBackendFactory();
		this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
		this.newId = options.newId ?? (() => randomUUID());
		this.probeLocalPtyFn = options.probeLocal ?? probeLocalPty;
	}

	capabilities(): TerminalCapabilities {
		const probe = this.probeLocalPtyFn();
		return probe.available ? { localPty: true } : { localPty: false, unavailableReason: probe.reason };
	}

	async open(ownerId: number, request: OpenTerminalRequest): Promise<OpenTerminalResult> {
		if (this.sessions.size >= this.maxSessions) {
			throw new TerminalOpenError(`too many terminals open (limit ${this.maxSessions})`);
		}
		const size = clampTerminalSize(request.cols, request.rows);
		const location = parseProjectLocation(request.cwd);

		let backend: Awaited<ReturnType<TerminalBackendFactory["open"]>>;
		let backendKind: OpenTerminalResult["backend"];
		let degraded: OpenTerminalResult["degraded"];

		if (location.kind === "ssh") {
			// 远程项目的终端必须在远端跑，`cwd` 是 ssh:// 时**绝不**退回本机执行：
			// 那会让用户以为自己在操作远端仓库（ADR-0124）。
			const opened = await this.remoteFactory.open({
				cwd: request.cwd,
				cols: size.cols,
				rows: size.rows,
			});
			backend = opened.backend;
			backendKind = opened.degraded ? "ssh-tty" : "ssh-helper";
			if (opened.degraded) degraded = { reason: "helper-unavailable", noResize: true };
		} else {
			backend = await this.localFactory.open({ cwd: location.path, cols: size.cols, rows: size.rows });
			backendKind = "local";
		}

		const session = new TerminalSession({ id: this.newId(), backend, backendKind });
		this.sessions.set(session.id, { session, ownerId });
		const replay = session.replay();
		return {
			terminalId: session.id,
			backend: backendKind,
			replay: replay.data,
			replayTruncated: replay.truncated,
			degraded,
		};
	}

	get(terminalId: string): TerminalSession | undefined {
		return this.sessions.get(terminalId)?.session;
	}

	dispose(terminalId: string): void {
		const entry = this.sessions.get(terminalId);
		if (!entry) return;
		this.sessions.delete(terminalId);
		entry.session.dispose();
	}

	/** 渲染进程销毁或导航时的兜底回收。 */
	disposeOwnedBy(ownerId: number): void {
		for (const [terminalId, entry] of [...this.sessions]) {
			if (entry.ownerId === ownerId) {
				this.sessions.delete(terminalId);
				entry.session.dispose();
			}
		}
	}

	disposeAll(): void {
		for (const [, entry] of [...this.sessions]) entry.session.dispose();
		this.sessions.clear();
	}

	get size(): number {
		return this.sessions.size;
	}
}
