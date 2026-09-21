import type { RemoteStatFlavor } from "./remote-command.js";

/** 远端上一个处于 LISTEN 状态的 TCP 端口。 */
export interface RemoteListeningPort {
	readonly port: number;
	/** 远端监听的地址，原样保留（`0.0.0.0`、`127.0.0.1`、`::`、`*`…）。 */
	readonly address: string;
	/** 占用端口的进程名。远端工具不给、或进程属于别的用户时为空。 */
	readonly processName?: string;
	readonly pid?: number;
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
	};
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
