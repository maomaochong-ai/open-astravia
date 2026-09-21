import type { RemoteStatFlavor } from "./remote-command.js";

/** 远端上一个处于 LISTEN 状态的 TCP 端口。 */
export interface RemoteListeningPort {
	readonly port: number;
	/** 远端监听的地址，原样保留（`0.0.0.0`、`127.0.0.1`、`::`、`*`…）。 */
	readonly address: string;
	/** 占用端口的进程名。远端工具不给、或进程属于别的用户时为空。 */
	readonly processName?: string;
	readonly pid?: number;
	/** 占用进程的完整命令行，用来分清两个都叫 `node` 的进程。 */
	readonly command?: string;
	/** 占用进程的启动时间（Unix 毫秒）。界面按它排序：刚起的服务排在最上面。 */
	readonly startedAt?: number;
	/**
	 * 系统端口：特权端口（< 1024）或这条连接自己用的 sshd 端口。
	 *
	 * 它们照样列出——用户确实可能想看 22 上跑着什么——但界面会单独折叠、置灰，并且不给
	 * 「终止」：停掉 sshd 等于把自己脚下这条连接拆了。
	 */
	readonly sensitive?: boolean;
}

/**
 * 实际用上的扫描手段。`none` 表示远端一个可用的工具都没有——它与「扫到 0 个端口」不是一回事，
 * 界面要据此提示用户手动输入端口号，而不是说「远端没有端口在听」。
 */
export type RemoteListenerTool = "helper" | "ss" | "netstat" | "lsof" | "none";

export interface RemoteListenerScan {
	readonly tool: RemoteListenerTool;
	readonly ports: RemoteListeningPort[];
}

/**
 * 输出首行的标记。
 *
 * 三种工具的输出格式互不兼容，而「远端实际有哪一个」只有远端自己知道。让脚本把选中的
 * 工具名打在第一行，解析器就不必靠猜列数来反推格式——猜错的表现是静默少列几个端口。
 */
const TOOL_MARKER = "@vetta-listeners";

/**
 * 列出远端所有 LISTEN 端口的命令。
 *
 * 按可用性依次退让而不是固定一个工具：`ss` 只在装了 iproute2 的 Linux 上有，`lsof` 是
 * macOS 的默认选择，精简镜像可能只剩 `netstat`。`LC_ALL=C` 锁住 locale——本地化过的表头
 * 与状态名会让解析全部落空。
 */
export function buildListListeningPortsCommand(flavor: RemoteStatFlavor): string {
	const commands: Record<Exclude<RemoteListenerTool, "none" | "helper">, string> = {
		ss: "LC_ALL=C ss -ltnp 2>/dev/null",
		netstat: "LC_ALL=C netstat -ltnp 2>/dev/null",
		lsof: "LC_ALL=C lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null",
	};
	// BSD 家族只用 lsof：那里的 netstat 用 `.` 而不是 `:` 分隔端口、`-p` 还要跟协议名，
	// 等于第四种格式；而 lsof 是 macOS 的自带命令，缺它的情况由 `none` 分支如实回答。
	const order: Exclude<RemoteListenerTool, "none" | "helper">[] =
		flavor === "bsd" ? ["lsof"] : ["ss", "netstat", "lsof"];
	const branches = order.map(
		(tool, index) =>
			`${index === 0 ? "if" : "elif"} command -v ${tool} >/dev/null 2>&1; then ` +
			`echo '${TOOL_MARKER} ${tool}'; ${commands[tool]}`,
	);
	return `${branches.join("; ")}; else echo '${TOOL_MARKER} none'; fi`;
}

/** 解析 {@link buildListListeningPortsCommand} 的输出。无法识别的行一律跳过。 */
export function parseRemoteListeners(output: string): RemoteListenerScan {
	const lines = output.split("\n");
	const markerIndex = lines.findIndex((line) => line.trimStart().startsWith(TOOL_MARKER));
	const tool = markerIndex < 0 ? "none" : toolFromMarker(lines[markerIndex] ?? "");
	if (tool === "none") return { tool: "none", ports: [] };
	const body = lines.slice(markerIndex + 1);
	const parse = tool === "lsof" ? parseLsofLine : tool === "ss" ? parseSsLine : parseNetstatLine;
	const ports: RemoteListeningPort[] = [];
	for (const line of body) {
		const port = parse(line);
		if (port) ports.push(port);
	}
	return { tool, ports };
}

function toolFromMarker(line: string): RemoteListenerTool {
	const name = line.trim().slice(TOOL_MARKER.length).trim();
	return name === "ss" || name === "netstat" || name === "lsof" ? name : "none";
}

/**
 * `ss -ltnp` 的一行：
 * `LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=1234,fd=23))`
 * busybox 的 ss 没有进程那一列，也不打印 users:(...)。
 */
function parseSsLine(line: string): RemoteListeningPort | undefined {
	const fields = line.trim().split(/\s+/);
	if (fields[0] !== "LISTEN") return undefined;
	const endpoint = splitHostPort(fields[3] ?? "");
	if (!endpoint) return undefined;
	const process = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
	return {
		...endpoint,
		processName: process?.[1],
		pid: process?.[2] === undefined ? undefined : Number.parseInt(process[2], 10),
	};
}

/**
 * `netstat -ltnp` 的一行：
 * `tcp 0 0 127.0.0.1:3000 0.0.0.0:* LISTEN 1234/node`
 * 没有权限看别人的进程时最后一列是 `-`，IPv6 的本地地址形如 `:::22`。
 */
function parseNetstatLine(line: string): RemoteListeningPort | undefined {
	const fields = line.trim().split(/\s+/);
	if (!fields[0]?.startsWith("tcp") || !fields.includes("LISTEN")) return undefined;
	const endpoint = splitHostPort(fields[3] ?? "");
	if (!endpoint) return undefined;
	const process = /(\d+)\/(\S+)\s*$/.exec(line);
	return {
		...endpoint,
		processName: process?.[2],
		pid: process?.[1] === undefined ? undefined : Number.parseInt(process[1], 10),
	};
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN` 的一行：
 * `node 1234 me 23u IPv4 0x1234 0t0 TCP 127.0.0.1:3000 (LISTEN)`
 * 进程名里可能有空格，所以只靠 `TCP <地址> (LISTEN)` 这段定位，命令名取行首那一列。
 */
function parseLsofLine(line: string): RemoteListeningPort | undefined {
	const match = /^(\S+)\s+(\d+)\s+.*\sTCP\s+(\S+)\s+\(LISTEN\)/.exec(line.trim());
	if (!match) return undefined;
	const endpoint = splitHostPort(match[3] ?? "");
	if (!endpoint) return undefined;
	return { ...endpoint, processName: match[1], pid: Number.parseInt(match[2] ?? "", 10) };
}

function splitHostPort(value: string): { address: string; port: number } | undefined {
	const index = value.lastIndexOf(":");
	if (index < 0) return undefined;
	const port = Number.parseInt(value.slice(index + 1), 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
	const raw = value.slice(0, index);
	const address = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
	return { address: address === "" ? "*" : address, port };
}

/** helper `net.listeners` 回来的一条，字段名以 Go 那边的 JSON tag 为准。 */
export interface HelperListener {
	readonly port: number;
	readonly address: string;
	readonly process?: string;
	readonly pid?: number;
	readonly command?: string;
	readonly startedAt?: number;
}

/**
 * 把 helper 的线上格式换成 {@link RemoteListeningPort}。
 *
 * 两边字段名不一样（`process` / `processName`），不能拿 helper 的结果直接当本类型用——
 * 类型上看不出差别，界面上的表现是 helper 路径下进程名永远是空的。
 */
export function fromHelperListener(listener: HelperListener): RemoteListeningPort {
	return {
		port: listener.port,
		address: listener.address,
		processName: listener.process || undefined,
		pid: listener.pid || undefined,
		command: listener.command || undefined,
		startedAt: listener.startedAt || undefined,
	};
}

/**
 * 端口是否属于系统：特权端口，或 `sshPort` 这条连接自己用的端口。
 *
 * 特权端口只有 root 能绑，上面跑的是 sshd、DNS、邮件这类系统服务；普通登录用户本来也
 * 杀不掉它们，摆在候选里只会把用户自己起的服务挤到下面去。
 */
export function isSensitiveListenerPort(port: number, sshPort?: number): boolean {
	return port < 1024 || port === sshPort;
}

/** `ps` 查出来的进程信息。 */
export interface RemoteProcessInfo {
	readonly command?: string;
	readonly startedAt?: number;
}

/**
 * 查一批进程的命令行与已运行时长。
 *
 * 只在 helper 不可用时走这条路（helper 直接读 `/proc`）。`etime` 而不是 `lstart`：后者的
 * 日期格式跟着 locale 和实现走，`etime` 在 procps 与 BSD ps 上都是 `[[dd-]hh:]mm:ss`。
 * busybox 的 ps 不认 `-p`，失败时静默返回空——少的只是时间和命令行，端口照样能列。
 */
export function buildProcessInfoCommand(pids: readonly number[]): string {
	const list = pids.filter((pid) => Number.isInteger(pid) && pid > 0).join(",");
	return `LC_ALL=C ps -o pid= -o etime= -o args= -p ${list} 2>/dev/null; true`;
}

/** 解析 {@link buildProcessInfoCommand} 的输出；`now` 用来把已运行时长换成启动时间。 */
export function parseProcessInfo(output: string, now: number): Map<number, RemoteProcessInfo> {
	const result = new Map<number, RemoteProcessInfo>();
	for (const line of output.split("\n")) {
		const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
		if (!match) continue;
		const elapsed = parseElapsedSeconds(match[2] ?? "");
		result.set(Number.parseInt(match[1] ?? "", 10), {
			command: match[3]?.trim() || undefined,
			startedAt: elapsed === undefined ? undefined : now - elapsed * 1000,
		});
	}
	return result;
}

/** `ps -o etime` 的 `[[dd-]hh:]mm:ss`。 */
function parseElapsedSeconds(value: string): number | undefined {
	const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
	if (!match) return undefined;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

/** {@link buildTerminateProcessCommand} 表示「信号发出去了、进程还没退」的退出码。 */
export const PROCESS_STILL_ALIVE_EXIT_CODE = 3;

/**
 * 终止远端一个进程，并等它真的退出（最多约 2 秒）。
 *
 * 只发信号就返回的话，界面紧接着重新扫描时端口多半还在，用户会以为点了没用。`force`
 * 发 SIGKILL，留给不理 SIGTERM 的进程。权限不够时 `kill` 自己报错、退出码非零。
 *
 * 僵尸进程算已退出：它的套接字已经关了，只是父进程还没回收，`kill -0` 对它照样成功。
 * 不认这一条的话，父进程不收尸时用户点多少次「强制终止」都显示还活着。
 */
export function buildTerminateProcessCommand(pid: number, force: boolean): string {
	if (!Number.isInteger(pid) || pid <= 1) throw new Error(`Refusing to signal pid ${pid}`);
	return (
		`kill -s ${force ? "KILL" : "TERM"} ${pid} || exit $?; ` +
		`i=0; while [ $i -lt 20 ]; do kill -0 ${pid} 2>/dev/null || exit 0; ` +
		`case "$(ps -o stat= -p ${pid} 2>/dev/null)" in *Z*) exit 0;; esac; sleep 0.1; i=$((i+1)); done; ` +
		`exit ${PROCESS_STILL_ALIVE_EXIT_CODE}`
	);
}

/**
 * 转发只可能连到远端的 `127.0.0.1`（见 `buildPortForwardArgv`），所以只有绑在回环或
 * 通配地址上的端口才转得过去。绑死在某张外网卡上的端口摆到界面上只会得到一条连不通的
 * 转发，不如不给。
 */
export function isForwardableListenerAddress(address: string): boolean {
	if (address === "*" || address === "0.0.0.0" || address === "::" || address === "[::]") return true;
	return address === "::1" || address.startsWith("127.");
}

export interface SelectForwardablePortsOptions {
	/** 不列出的端口，例如这条连接自己用的 sshd 端口。 */
	readonly excludePorts?: readonly number[];
}

/**
 * 整理成可以摆给用户的清单：滤掉转不过去的地址、按端口去重、端口号升序。
 *
 * 同一个服务经常同时出现在 `0.0.0.0` 和 `::` 上，对用户是同一个端口；保留先出现的那条，
 * 因为带进程名的那一条通常排在前面。
 */
export function selectForwardablePorts(
	ports: readonly RemoteListeningPort[],
	options: SelectForwardablePortsOptions = {},
): RemoteListeningPort[] {
	const excluded = new Set(options.excludePorts ?? []);
	const byPort = new Map<number, RemoteListeningPort>();
	for (const port of ports) {
		if (excluded.has(port.port) || !isForwardableListenerAddress(port.address)) continue;
		const existing = byPort.get(port.port);
		// 已有一条但没进程名时，让带进程名的那条补上——用户靠它认出是哪个服务。
		if (!existing) byPort.set(port.port, port);
		else if (!existing.processName && port.processName) byPort.set(port.port, port);
	}
	return [...byPort.values()].sort((left, right) => left.port - right.port);
}
