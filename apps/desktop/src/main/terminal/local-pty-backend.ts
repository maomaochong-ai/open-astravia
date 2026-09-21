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
		this.pty.kill();
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
