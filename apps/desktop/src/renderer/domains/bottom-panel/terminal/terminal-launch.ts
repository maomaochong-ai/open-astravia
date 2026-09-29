import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";

/**
 * 「开一个终端并替用户敲一条命令」的请求与它在 tab 载荷里的持久化形状。
 *
 * 命令是**敲进交互式 shell** 的，不是另起一个进程执行：这样本机 PTY、远端 helper 与
 * `ssh -tt` 降级三条后端不用各自学会「带命令启动」，命令跑完 shell 也还在，用户能接着
 * 按上箭头重跑。代价是 shell 的 rc 文件还没加载完时命令已经进了输入缓冲——PTY 会替它
 * 排队，效果与用户手快提前敲字相同。
 */
export interface TerminalLaunch {
	readonly command: string;
	/** 省略即会话 cwd；给了就必须是会话 cwd 本身或它下面的目录。 */
	readonly cwd?: string;
	readonly label?: string;
}

export interface TerminalLaunchPayload {
	readonly kind: "terminal-launch";
	readonly command: string;
	readonly cwd?: string;
	readonly label?: string;
	/**
	 * 命令是否已经敲过。重开会话时终端会起一个新 shell，此时**绝不能**再敲一遍：
	 * 用户上次跑的可能是部署或数据迁移。
	 */
	readonly issued: boolean;
}

export const TERMINAL_LAUNCH_MAX_COMMAND_LENGTH = 4096;
export const TERMINAL_LAUNCH_MAX_LABEL_LENGTH = 80;

/** 换行会让一次调用执行多条命令，其余控制字符能改写终端状态；两者都不是「一条命令」。 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function trimTrailingSeparators(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	return trimmed.length > 0 ? trimmed : path;
}

function hasParentSegment(path: string): boolean {
	return path.split(/[\\/]/).some((segment) => segment === "..");
}

/**
 * `target` 是否是 `root` 本身或它下面的路径。纯字符串比较，不碰文件系统：
 * 渲染进程没有 `node:path`，而这里只需要挡住「跑到项目外面」这一种误用。
 */
export function isPathWithinCwd(target: string, root: string): boolean {
	if (hasParentSegment(target)) return false;
	let targetLocation: ReturnType<typeof parseProjectLocation>;
	let rootLocation: ReturnType<typeof parseProjectLocation>;
	try {
		targetLocation = parseProjectLocation(target);
		rootLocation = parseProjectLocation(root);
	} catch {
		return false;
	}
	if (targetLocation.kind === "ssh" || rootLocation.kind === "ssh") {
		if (targetLocation.kind !== "ssh" || rootLocation.kind !== "ssh") return false;
		if (targetLocation.hostId !== rootLocation.hostId) return false;
		const base = trimTrailingSeparators(rootLocation.remotePath);
		const child = trimTrailingSeparators(targetLocation.remotePath);
		return child === base || child.startsWith(base === "/" ? "/" : `${base}/`);
	}
	// Windows 路径大小写不敏感、分隔符两种都可能出现；统一后再比。
	const windows = /^[a-zA-Z]:[\\/]/.test(rootLocation.path) || rootLocation.path.startsWith("\\\\");
	const normalize = (value: string): string => {
		const unified = trimTrailingSeparators(value.replace(/\\/g, "/"));
		return windows ? unified.toLowerCase() : unified;
	};
	const base = normalize(rootLocation.path);
	const child = normalize(targetLocation.path);
	return child === base || child.startsWith(base.endsWith("/") ? base : `${base}/`);
}

/** 校验并规整一条启动请求；不合规直接抛，错误文案面向插件作者。 */
export function parseTerminalLaunch(input: unknown, scopeCwd: string | null): TerminalLaunch {
	if (!scopeCwd) throw new Error("openTerminal: this panel is not bound to a project directory");
	if (typeof input !== "object" || input === null) throw new Error("openTerminal: request must be an object");
	const { command, cwd, label } = input as Record<string, unknown>;
	if (typeof command !== "string" || command.trim().length === 0) {
		throw new Error("openTerminal: command must be a non-empty string");
	}
	if (command.length > TERMINAL_LAUNCH_MAX_COMMAND_LENGTH) throw new Error("openTerminal: command is too long");
	if (CONTROL_CHARACTERS.test(command)) {
		throw new Error("openTerminal: command must be a single line without control characters");
	}
	if (cwd !== undefined && (typeof cwd !== "string" || !isPathWithinCwd(cwd, scopeCwd))) {
		throw new Error("openTerminal: cwd must be the session directory or a directory inside it");
	}
	if (label !== undefined && (typeof label !== "string" || CONTROL_CHARACTERS.test(label))) {
		throw new Error("openTerminal: label must be a plain string");
	}
	const trimmedLabel = label?.trim().slice(0, TERMINAL_LAUNCH_MAX_LABEL_LENGTH);
	return {
		command: command.trim(),
		...(cwd === undefined ? {} : { cwd }),
		...(trimmedLabel ? { label: trimmedLabel } : {}),
	};
}

export function toTerminalLaunchPayload(launch: TerminalLaunch): TerminalLaunchPayload {
	return { kind: "terminal-launch", ...launch, issued: false };
}

/**
 * 从 tab 载荷里读回启动信息。载荷来自 localStorage，形状不对或 cwd 越出会话目录都当没有：
 * 宁可开一个普通终端，也不在错误的目录里替用户敲命令。
 */
export function readTerminalLaunchPayload(payload: unknown, scopeCwd: string | null): TerminalLaunchPayload | null {
	if (typeof payload !== "object" || payload === null) return null;
	const value = payload as Record<string, unknown>;
	if (value.kind !== "terminal-launch" || typeof value.issued !== "boolean") return null;
	try {
		const launch = parseTerminalLaunch(value, scopeCwd);
		return { ...toTerminalLaunchPayload(launch), issued: value.issued };
	} catch {
		return null;
	}
}

/**
 * 终端就绪后要不要替用户敲命令：还没敲过就给出要写进 PTY 的输入和「已敲过」的新载荷。
 * 调用方必须**先写回载荷再写输入**——写入失败顶多是命令没跑，反过来则可能在重开会话时
 * 把部署再跑一遍。
 */
export function claimTerminalLaunch(
	launch: TerminalLaunchPayload | null,
): { readonly payload: TerminalLaunchPayload; readonly input: string } | null {
	if (!launch || launch.issued) return null;
	return { payload: { ...launch, issued: true }, input: `${launch.command}\r` };
}
