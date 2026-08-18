import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
	type CodingAgentSpec,
	decodeEvent,
	EVENT_LOG,
	EVENT_METRIC,
	EVENT_READY,
	EVENT_STATE_PATCH,
	EVENT_STATUS,
	EVENT_WECHAT_BIND_STATUS,
	EVENT_WECHAT_BOUND,
	EVENT_WECHAT_QR,
	EVENT_WECHAT_UNBOUND,
	encodeFrame,
	type FeishuConfig,
	FRAME_CONFIG_UPDATE,
	FRAME_INIT,
	FRAME_SHUTDOWN,
	FRAME_WECHAT_BIND_START,
	FRAME_WECHAT_LOGOUT,
	type LogEvent,
	type MetricEvent,
	type OutboundEvent,
	type ReadyEvent,
	type SessionStateEntry,
	type StatePatchEvent,
	type StatusEvent,
	type WechatBindStatusEvent,
	type WechatBoundEvent,
	type WechatConfig,
	type WechatQREvent,
	type WechatUnboundEvent,
} from "./host-protocol.js";

/**
 * Manages the lifecycle of one im-gateway sidecar child process.
 *
 * Responsibilities:
 *  - spawn the binary (path supplied by binary-resolver)
 *  - send the init frame; await the ready event with a 10s timeout
 *  - parse stdout NDJSON and dispatch typed events to handlers
 *  - automatic restart with exponential backoff on crash / startup failure
 *  - graceful shutdown via shutdown frame → SIGTERM → SIGKILL escalation
 *
 * The manager is intentionally agnostic about persistence (state-store and
 * config-store live one layer up); it just reports events upward via the
 * supplied SidecarHooks.
 */

export interface SidecarHooks {
	/** Sidecar emitted a ready event after init handshake. */
	onReady?: (event: ReadyEvent) => void;
	/** Transport status changed. */
	onStatus?: (event: StatusEvent) => void;
	/** A log line. Subscribers usually push into a ring buffer. */
	onLog?: (event: LogEvent) => void;
	/** Routing-table mutation; the parent persists this. */
	onStatePatch?: (event: StatePatchEvent) => void;
	/** Generic numeric metric. */
	onMetric?: (event: MetricEvent) => void;
	/** Backoff/restart-cycle reported a definitive failure. */
	onFatal?: (reason: string) => void;
	/** Sidecar successfully launched (after spawn returns); pid included. */
	onSpawned?: (pid: number) => void;
	/** Sidecar process exited (any reason). */
	onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;

	// Wechat-specific bind flow events. The sidecar emits these only when
	// wechat is the active transport AND the parent has driven a bind via
	// startWechatBind() (or the bind is auto-started after a logout).
	/** A new QR code is ready for the user to scan. */
	onWechatQR?: (event: WechatQREvent) => void;
	/** A transition in the bind state machine. */
	onWechatBindStatus?: (event: WechatBindStatusEvent) => void;
	/** Bind succeeded — credentials persisted, transport about to start. */
	onWechatBound?: (event: WechatBoundEvent) => void;
	/** Credentials cleared (logout or expiry). Sidecar is now in awaiting_bind. */
	onWechatUnbound?: (event: WechatUnboundEvent) => void;
}

/**
 * SidecarConfig describes one (feishu, wechat) selection. Exactly one of
 * `feishu` / `wechat` should be populated; the other should be undefined.
 *
 * The sidecar prefers wechat over feishu when both are present, but the
 * parent should never rely on that — pick one based on the user's
 * `transport` setting in im-config.json.
 */
export interface SidecarConfig {
	binaryPath: string;
	feishu?: FeishuConfig;
	wechat?: WechatConfig;
	/**
	 * Absolute cwd of desktop-app's default "对话" project. The sidecar
	 * routes every IM session into this directory (see ADR-0004 +
	 * CONTEXT.md → "conversation cwd"). Required.
	 */
	conversationCwd: string;
	state: SessionStateEntry[];
	/**
	 * Tells the sidecar which binary + prefix args to use when spawning
	 * coding-agent for each IM session. Required in production (no `vetta`
	 * on PATH); the dev path populates it too so behavior matches.
	 */
	codingAgent?: CodingAgentSpec;
}

export interface SidecarManagerOptions {
	hooks?: SidecarHooks;
	/** Override timing for tests. */
	readyTimeoutMs?: number;
	shutdownGraceMs?: number;
	backoffMs?: number[];
	maxRestartAttempts?: number;
}

const DEFAULT_READY_TIMEOUT = 10_000;
const DEFAULT_SHUTDOWN_GRACE = 5_000;
const DEFAULT_BACKOFF = [5_000, 15_000, 60_000];
const DEFAULT_MAX_RESTARTS = 5;

type ManagerState =
	| { kind: "idle" }
	| { kind: "spawning"; child: ChildProcess; readyTimer: NodeJS.Timeout }
	| { kind: "running"; child: ChildProcess }
	| { kind: "stopping"; child: ChildProcess }
	| { kind: "backoff"; timer: NodeJS.Timeout }
	| { kind: "fatal"; reason: string };

export class SidecarManager {
	private state: ManagerState = { kind: "idle" };
	private currentConfig?: SidecarConfig;
	private restartAttempts = 0;
	private readonly hooks: SidecarHooks;
	private readonly readyTimeoutMs: number;
	private readonly shutdownGraceMs: number;
	private readonly backoffMs: number[];
	private readonly maxRestartAttempts: number;

	constructor(opts: SidecarManagerOptions = {}) {
		this.hooks = opts.hooks ?? {};
		this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT;
		this.shutdownGraceMs = opts.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE;
		this.backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF;
		this.maxRestartAttempts = opts.maxRestartAttempts ?? DEFAULT_MAX_RESTARTS;
	}

	/**
	 * Spawn the sidecar with the given configuration. If a sidecar is
	 * already running it will be replaced. Idempotent on identical calls.
	 */
	async start(config: SidecarConfig): Promise<void> {
		this.currentConfig = config;
		await this.stopInternal();
		this.restartAttempts = 0;
		this.spawn();
	}

	/**
	 * Reapply runtime configuration. Credential / transport / conversation
	 * cwd changes always restart the sidecar — the gateway no longer has a
	 * soft "runtime update" path (project list is gone, see ADR-0004).
	 */
	async applyConfig(next: SidecarConfig): Promise<void> {
		this.currentConfig = next;
		await this.stopInternal();
		this.restartAttempts = 0;
		this.spawn();
	}

	/** Manual restart triggered by the UI. Resets backoff. */
	async restart(): Promise<void> {
		if (!this.currentConfig) return;
		await this.stopInternal();
		this.restartAttempts = 0;
		this.spawn();
	}

	/** Permanently stop the sidecar. */
	async stop(): Promise<void> {
		await this.stopInternal();
		this.currentConfig = undefined;
		this.state = { kind: "idle" };
	}

	/**
	 * Force-kill any running sidecar synchronously and wait briefly for
	 * exit. Used from before-quit, where we cannot await timers.
	 */
	async shutdownForQuit(): Promise<void> {
		await this.stopInternal();
	}

	/** Backoff timer expired or fatal latch was tripped. */
	getCurrentChild(): ChildProcess | undefined {
		if (this.state.kind === "running" || this.state.kind === "spawning") {
			return this.state.child;
		}
		return undefined;
	}

	// =========================================================================
	// internals
	// =========================================================================

	private spawn(): void {
		if (!this.currentConfig) return;
		const cfg = this.currentConfig;

		let child: ChildProcess;
		try {
			child = spawn(cfg.binaryPath, ["host"], {
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err) {
			this.handleSpawnFailure(err instanceof Error ? err.message : String(err));
			return;
		}

		if (!child.pid) {
			this.handleSpawnFailure("spawn returned no pid");
			return;
		}

		this.hooks.onSpawned?.(child.pid);

		const readyTimer = setTimeout(() => {
			if (this.state.kind === "spawning" && this.state.child === child) {
				// Timed out waiting for ready: kill child and treat as
				// failure.
				try {
					child.kill();
				} catch {
					// ignore
				}
				this.handleSpawnFailure(`ready event not received within ${this.readyTimeoutMs}ms`);
			}
		}, this.readyTimeoutMs);

		this.state = { kind: "spawning", child, readyTimer };

		// Wire up stdout / stderr / exit before sending init.
		this.attachReaders(child);
		child.on("exit", (code, signal) => this.handleExit(child, code, signal));
		child.on("error", (err) => this.handleSpawnFailure(`spawn error: ${err.message}`));

		// Now send the init frame. Stdin is set up in attachReaders via
		// child.stdin reference.
		this.writeFrame({
			type: FRAME_INIT,
			feishu: cfg.feishu,
			wechat: cfg.wechat,
			conversationCwd: cfg.conversationCwd,
			state: cfg.state,
			codingAgent: cfg.codingAgent,
		});
	}

	/**
	 * Send a wechat_bind_start frame to a running sidecar. Caller is
	 * responsible for ensuring the sidecar is in awaiting_bind / bound
	 * state and that wechat is the active transport — the sidecar will
	 * silently ignore the frame otherwise (logged at warn level).
	 */
	startWechatBind(): void {
		if (this.state.kind !== "running") {
			this.hooks.onLog?.({
				type: EVENT_LOG,
				level: "warn",
				msg: `sidecar not running; cannot start wechat bind (state=${this.state.kind})`,
				time: new Date().toISOString(),
			});
			return;
		}
		this.writeFrame({ type: FRAME_WECHAT_BIND_START });
	}

	/**
	 * Send a wechat_logout frame to a running sidecar. Clears the on-disk
	 * wechat credentials and parks the sidecar in awaiting_bind state. The
	 * caller still needs to update its UI based on the resulting onWechatUnbound
	 * + onStatus events.
	 */
	wechatLogout(): void {
		if (this.state.kind !== "running") {
			this.hooks.onLog?.({
				type: EVENT_LOG,
				level: "warn",
				msg: `sidecar not running; cannot send wechat logout (state=${this.state.kind})`,
				time: new Date().toISOString(),
			});
			return;
		}
		this.writeFrame({ type: FRAME_WECHAT_LOGOUT });
	}

	private attachReaders(child: ChildProcess): void {
		if (child.stdout) {
			const rl: Interface = createInterface({ input: child.stdout });
			rl.on("line", (line) => {
				this.handleEventLine(line);
			});
		}
		if (child.stderr) {
			child.stderr.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf-8").trim();
				if (text.length === 0) return;
				// Treat stderr as a fatal log line; sidecar reserves
				// stderr for unrecoverable panics.
				this.hooks.onLog?.({
					type: EVENT_LOG,
					level: "error",
					msg: text,
					time: new Date().toISOString(),
				});
			});
		}
	}

	private handleEventLine(line: string): void {
		let event: OutboundEvent | null;
		try {
			event = decodeEvent(line);
		} catch (err) {
			this.hooks.onLog?.({
				type: EVENT_LOG,
				level: "error",
				msg: `hostproto decode failed: ${(err as Error).message}`,
				time: new Date().toISOString(),
			});
			return;
		}
		if (!event) return;

		switch (event.type) {
			case EVENT_READY:
				this.handleReady(event);
				break;
			case EVENT_STATUS:
				this.hooks.onStatus?.(event);
				break;
			case EVENT_LOG:
				this.hooks.onLog?.(event);
				break;
			case EVENT_STATE_PATCH:
				this.hooks.onStatePatch?.(event);
				break;
			case EVENT_METRIC:
				this.hooks.onMetric?.(event);
				break;
			case EVENT_WECHAT_QR:
				this.hooks.onWechatQR?.(event);
				break;
			case EVENT_WECHAT_BIND_STATUS:
				this.hooks.onWechatBindStatus?.(event);
				break;
			case EVENT_WECHAT_BOUND:
				this.hooks.onWechatBound?.(event);
				break;
			case EVENT_WECHAT_UNBOUND:
				this.hooks.onWechatUnbound?.(event);
				break;
		}
	}

	private handleReady(event: ReadyEvent): void {
		if (this.state.kind !== "spawning") return;
		clearTimeout(this.state.readyTimer);
		this.restartAttempts = 0;
		this.state = { kind: "running", child: this.state.child };
		this.hooks.onReady?.(event);
	}

	private handleSpawnFailure(reason: string): void {
		if (this.state.kind === "spawning") {
			clearTimeout(this.state.readyTimer);
		}
		this.restartAttempts += 1;

		if (this.restartAttempts >= this.maxRestartAttempts) {
			const msg = `sidecar failed to start ${this.restartAttempts} times in a row: ${reason}`;
			this.state = { kind: "fatal", reason: msg };
			this.hooks.onFatal?.(msg);
			return;
		}

		const idx = Math.min(this.restartAttempts - 1, this.backoffMs.length - 1);
		const delay = this.backoffMs[idx] ?? 60_000;
		const timer = setTimeout(() => {
			this.spawn();
		}, delay);
		this.state = { kind: "backoff", timer };
		this.hooks.onLog?.({
			type: EVENT_LOG,
			level: "warn",
			msg: `sidecar restart scheduled in ${Math.round(delay / 1000)}s (attempt ${this.restartAttempts}/${this.maxRestartAttempts}): ${reason}`,
			time: new Date().toISOString(),
		});
	}

	private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
		this.hooks.onExit?.(code, signal);

		if (this.state.kind === "stopping") {
			// Expected exit during a graceful stop — leave state alone;
			// stopInternal's resolver will set it.
			return;
		}

		if (this.state.kind === "spawning" && this.state.child === child) {
			clearTimeout(this.state.readyTimer);
		}
		// Treat any unsolicited exit as a failure → backoff path.
		this.handleSpawnFailure(`process exited code=${code} signal=${signal}`);
	}

	private async stopInternal(): Promise<void> {
		if (this.state.kind === "idle" || this.state.kind === "fatal") {
			return;
		}
		if (this.state.kind === "backoff") {
			clearTimeout(this.state.timer);
			this.state = { kind: "idle" };
			return;
		}

		const child = this.state.kind === "spawning" || this.state.kind === "running" ? this.state.child : undefined;

		if (this.state.kind === "spawning") {
			clearTimeout(this.state.readyTimer);
		}

		if (!child || child.exitCode != null) {
			this.state = { kind: "idle" };
			return;
		}

		this.state = { kind: "stopping", child };

		// 1. Polite shutdown frame via stdin.
		try {
			this.writeFrame({ type: FRAME_SHUTDOWN });
		} catch {
			// stdin may already be closed
		}
		// 2. Close stdin so the sidecar's stdin reader sees EOF.
		try {
			child.stdin?.end();
		} catch {
			// ignore
		}

		// 3. Wait up to shutdownGraceMs for natural exit.
		const exited = await waitForExit(child, this.shutdownGraceMs);

		if (!exited) {
			// 4. SIGTERM (or child.kill() on Windows).
			try {
				child.kill();
			} catch {
				// ignore
			}
			const exited2 = await waitForExit(child, 2_000);
			if (!exited2) {
				try {
					child.kill("SIGKILL");
				} catch {
					// ignore
				}
				await waitForExit(child, 1_000);
			}
		}

		this.state = { kind: "idle" };
	}

	private writeFrame(frame: Parameters<typeof encodeFrame>[0]): void {
		const child = this.getActiveChild();
		if (!child?.stdin || child.stdin.destroyed) return;
		try {
			child.stdin.write(encodeFrame(frame));
		} catch {
			// stdin write failure → next exit handler will deal with it
		}
	}

	private getActiveChild(): ChildProcess | undefined {
		if (this.state.kind === "spawning" || this.state.kind === "running" || this.state.kind === "stopping") {
			return this.state.child;
		}
		return undefined;
	}
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (child.exitCode != null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const onExit = () => {
			clearTimeout(timer);
			resolve(true);
		};
		const timer = setTimeout(() => {
			child.removeListener("exit", onExit);
			resolve(false);
		}, timeoutMs);
		child.once("exit", onExit);
	});
}

// re-export for callers that want to construct frames externally (e.g.
// test connection probes that bypass the manager).
export { FRAME_CONFIG_UPDATE };
