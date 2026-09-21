import { createRequire } from "node:module";
import type * as NodePty from "@lydell/node-pty";
import { getAppLogger } from "../logger.js";
import { createTerminalEnvironment, resolveTerminalShell } from "./resolve-terminal-shell.js";
import type {
	OpenTerminalBackendOptions,
	TerminalBackend,
	TerminalBackendFactory,
	TerminalExitEvent,
} from "./terminal-backend.js";

const log = getAppLogger("terminal");

type NodePtyModule = typeof NodePty;

/**
 * node-pty 是原生模块，且真正的 pty.node 在按平台+架构拆分的包里。
 * 懒加载而不是顶层 import：某个平台缺预编译二进制时，应用仍应正常启动，只是终端不可用
 * ——这条降级路径从第一天就要有，否则一个平台的缺包会变成整个应用起不来。
 */
let cached: { module: NodePtyModule } | { error: Error } | undefined;

function loadNodePty(): NodePtyModule {
	if (cached && "module" in cached) return cached.module;
	if (cached && "error" in cached) throw cached.error;
	try {
		const require = createRequire(import.meta.url);
		const module = require("@lydell/node-pty") as NodePtyModule;
		cached = { module };
		return module;
	} catch (cause) {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		cached = { error };
		log.warn(`local pty unavailable: ${error.message}`);
		throw error;
	}
}

export interface LocalPtyAvailability {
	readonly available: boolean;
	readonly reason?: string;
}

export function probeLocalPty(): LocalPtyAvailability {
	try {
		loadNodePty();
		return { available: true };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** 仅供测试重置探测缓存。 */
export function resetLocalPtyProbeForTests(): void {
	cached = undefined;
}

class LocalPtyBackend implements TerminalBackend {
	private readonly startupProcess: string;

	constructor(
		private readonly pty: NodePty.IPty,
		startupProcess: string,
	) {
		this.startupProcess = startupProcess;
	}

	write(data: string): void {
		this.pty.write(data);
	}

	resize(cols: number, rows: number): void {
		this.pty.resize(cols, rows);
	}

	foregroundProcess(): string | undefined {
		// node-pty 报的是前台进程标题；与启动 shell 同名时说明没有别的东西在跑。
		const current = this.pty.process;
		if (!current || current === this.startupProcess) return undefined;
		return current;
	}

	kill(): void {
		hangUpPty(this.pty);
	}

	onData(listener: (chunk: string) => void): () => void {
		const subscription = this.pty.onData(listener);
		return () => subscription.dispose();
	}

	onExit(listener: (event: TerminalExitEvent) => void): () => void {
		const subscription = this.pty.onExit(({ exitCode, signal }) => listener({ exitCode, signal }));
		return () => subscription.dispose();
	}
}

/**
 * {@link hangUpPty} 只需要这两个方法，单测不必造一个完整的 IPty。
 *
 * `destroy` 可选：它在 node-pty 的 Unix/Windows 两个实现上都有，却没写进导出的 `IPty`
 * 接口，所以这里按「可能没有」处理，而不是断言它一定在。
 */
export interface HangUpTarget {
	kill(signal?: string): void;
	destroy?: () => void;
}

/**
 * 收掉一个 pty，两步缺一不可。
 *
 * 1. SIGHUP 给 shell：shell 收到后会把 SIGHUP 转给自己作业表里的进程，再自己退出。
 *    正常情况下 dev server 就是这样停下来的。
 * 2. 关掉 pty 主端：shell 卡住、或者作业已经脱离了 shell 的作业表时没人转发，此时内核会
 *    直接把 SIGHUP 发给 pty 的**前台进程组**——用户 `npm run dev` 起的那个 node 正在
 *    那个进程组里。
 *
 * node-pty 的 `kill()` 只做第一步，主端一直开着；`destroy()` 做第二步，但它把补发的
 * SIGHUP 挂在 socket 的 close 回调上，而退出路径上紧跟着就是 `app.exit(0)`，那个回调
 * 不一定还有机会跑。所以这里两步都自己来，且顺序是先同步发信号再关主端。
 *
 * 任一步失败都不影响另一步：进程可能已经自己走了。
 */
export function hangUpPty(target: HangUpTarget): void {
	try {
		target.kill("SIGHUP");
	} catch {
		// 进程已经退出，pid 不存在。
	}
	try {
		target.destroy?.();
	} catch {
		// 主端已经关了。
	}
}

export function createLocalPtyBackendFactory(): TerminalBackendFactory {
	return {
		async open(options: OpenTerminalBackendOptions): Promise<TerminalBackend> {
			const pty = loadNodePty();
			const shell = resolveTerminalShell({ customShellPath: options.shellPath });
			const spawned = pty.spawn(shell.file, [...shell.args], {
				cwd: options.cwd,
				cols: options.cols,
				rows: options.rows,
				env: createTerminalEnvironment(),
				name: "xterm-256color",
			});
			return new LocalPtyBackend(spawned, spawned.process);
		},
	};
}
