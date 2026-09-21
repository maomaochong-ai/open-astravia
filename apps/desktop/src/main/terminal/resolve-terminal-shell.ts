import { existsSync } from "node:fs";

/**
 * 交互式终端的 shell 选择。
 *
 * 刻意不复用 `packages/runtime-node` 的 `resolveNodeShell`：那个解析出来的是一次性
 * 非交互调用（`-c` / `-NoProfile -NonInteractive -Command`），用它起终端会得到一个
 * 读不到用户 profile、没有别名、拿不到 nvm/pyenv 注入的 PATH 的壳，而且 `-c` 还要求
 * 后面跟命令串。终端要的正好相反：登录 shell、不带命令、交互性由 PTY 提供。
 */

export interface TerminalShellInvocation {
	readonly file: string;
	readonly args: readonly string[];
}

export interface ResolveTerminalShellOptions {
	readonly platform?: NodeJS.Platform;
	readonly env?: NodeJS.ProcessEnv;
	/** 用户在设置里自定义的 shell 路径。 */
	readonly customShellPath?: string;
	readonly fileExists?: (path: string) => boolean;
}

const POSIX_FALLBACKS = ["/bin/zsh", "/bin/bash", "/bin/sh"];
const WINDOWS_CANDIDATES = [
	"C:\\Program Files\\PowerShell\\7\\pwsh.exe",
	"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
	"C:\\Windows\\System32\\cmd.exe",
];

/**
 * 按两种分隔符取文件名：跨平台解析 Windows 路径时不能用 `node:path` 的 basename，
 * 它在 posix 宿主上不认反斜杠，会把整条 `C:\...\pwsh.exe` 当成文件名。
 */
function shellFileName(file: string): string {
	const separator = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
	return (separator === -1 ? file : file.slice(separator + 1)).toLowerCase();
}

function isPowerShell(file: string): boolean {
	return ["pwsh.exe", "pwsh", "powershell.exe", "powershell"].includes(shellFileName(file));
}

/** 登录参数：只有这样才能拿到用户 profile 注入的 PATH，与远端 helper 的 `$SHELL -l` 一致。 */
function posixArgs(): readonly string[] {
	return ["-l"];
}

function windowsArgs(file: string): readonly string[] {
	// 不带 -Command / -NonInteractive：那些会让 shell 跑完就退。
	return isPowerShell(file) ? ["-NoLogo"] : [];
}

export function resolveTerminalShell(options: ResolveTerminalShellOptions = {}): TerminalShellInvocation {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const fileExists = options.fileExists ?? existsSync;

	if (options.customShellPath) {
		if (!fileExists(options.customShellPath)) {
			// 自定义路径写错时报错而不是悄悄换一个：用户会以为自己的配置生效了。
			throw new Error(`Custom shell path not found: ${options.customShellPath}`);
		}
		return {
			file: options.customShellPath,
			args: platform === "win32" ? windowsArgs(options.customShellPath) : posixArgs(),
		};
	}

	if (platform === "win32") {
		const comspec = env.COMSPEC;
		const candidates = [...WINDOWS_CANDIDATES, ...(comspec ? [comspec] : [])];
		const found = candidates.find((candidate) => fileExists(candidate));
		const file = found ?? comspec ?? "cmd.exe";
		return { file, args: windowsArgs(file) };
	}

	const fromEnv = env.SHELL;
	if (fromEnv && fileExists(fromEnv)) return { file: fromEnv, args: posixArgs() };
	const fallback = POSIX_FALLBACKS.find((candidate) => fileExists(candidate));
	return { file: fallback ?? "/bin/sh", args: posixArgs() };
}

/** Vetta 内部用的变量不该漏进用户终端，否则子进程行为会跟着宿主跑偏。 */
const STRIPPED_ENV_PREFIXES = ["VETTA_", "ELECTRON_"];
const STRIPPED_ENV_KEYS = ["NODE_OPTIONS", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "DISPLAY_ASKPASS"];

export function createTerminalEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
		if (STRIPPED_ENV_KEYS.includes(key)) continue;
		result[key] = value;
	}
	// 让远端/本地程序知道这是个真终端且支持真彩色，否则 ls 不上色、TUI 走降级渲染。
	result.TERM = "xterm-256color";
	result.COLORTERM = "truecolor";
	return result;
}
