/**
 * 远程项目的规范化标识：`ssh://<hostId>/<绝对路径>`。
 *
 * 为什么把远程项目也塞进同一个字符串，而不是给项目加一个并列的 `host` 字段：整个
 * Desktop 把「cwd 字符串」当成项目和会话的主键——会话分片目录、活动标签的 keying、
 * 侧边栏展开集合全都用它做 Map 的 key。换成结构化字段要同时改这些地方，且每一处漏改
 * 都表现为「远程项目和本地同名项目共用一条会话历史」这种难查的串台。用带 scheme 的
 * URI 就能让这些地方原样工作，只有真正做 I/O 的边界才需要解析。
 *
 * 同样的原因，这里不用 `new URL()`：它会对路径做百分号编码，于是同一个远端路径在
 * 「用户输入」和「往返一次之后」会得到两个不同的字符串，主键就裂了。
 */

export const SSH_PROJECT_SCHEME = "ssh://";

export interface LocalProjectLocation {
	readonly kind: "local";
	/** 本机绝对路径。 */
	readonly path: string;
}

export interface SshProjectLocation {
	readonly kind: "ssh";
	/** 指向配置里某台 SSH 主机的 id，不是主机名——主机名可以被用户改掉。 */
	readonly hostId: string;
	/** 远端绝对路径，始终是 POSIX 形式。 */
	readonly remotePath: string;
}

export type ProjectLocation = LocalProjectLocation | SshProjectLocation;

/** hostId 出现在 URI 的 authority 段，不能含有会改变解析结果的字符。 */
const HOST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isSshProjectUri(value: string): boolean {
	return value.startsWith(SSH_PROJECT_SCHEME);
}

export function formatSshProjectUri(hostId: string, remotePath: string): string {
	if (!HOST_ID_PATTERN.test(hostId)) {
		throw new Error(`Invalid SSH host id: ${hostId}`);
	}
	if (!remotePath.startsWith("/")) {
		throw new Error(`Remote project path must be absolute: ${remotePath}`);
	}
	return `${SSH_PROJECT_SCHEME}${hostId}${normalizeRemotePath(remotePath)}`;
}

export function formatProjectLocation(location: ProjectLocation): string {
	return location.kind === "local" ? location.path : formatSshProjectUri(location.hostId, location.remotePath);
}

/**
 * 把项目标识解析成位置。
 *
 * 不是 `ssh://` 开头的一律视为本地路径并原样返回——包括 Windows 的 `C:\...`，以及
 * 历史配置里可能存在的相对路径。这里不做「看起来像不像绝对路径」的判断，那是
 * ProjectService 注册时的校验职责，解析阶段擅自改写会把已登记的项目变成另一个主键。
 */
export function parseProjectLocation(value: string): ProjectLocation {
	if (!isSshProjectUri(value)) return { kind: "local", path: value };
	const rest = value.slice(SSH_PROJECT_SCHEME.length);
	const separator = rest.indexOf("/");
	if (separator <= 0) {
		throw new Error(`Malformed SSH project URI: ${value}`);
	}
	const hostId = rest.slice(0, separator);
	if (!HOST_ID_PATTERN.test(hostId)) {
		throw new Error(`Malformed SSH project URI: ${value}`);
	}
	return { kind: "ssh", hostId, remotePath: normalizeRemotePath(rest.slice(separator)) };
}

/**
 * 把项目 cwd 交给 `node:path` 之前必须先过这里。
 *
 * `resolve("ssh://h/srv/app")` 得到的是 `<当前进程目录>/ssh:/h/srv/app`——一个既不是
 * 远端路径、也不指向任何真实位置的本地路径。更糟的是它不再以 `ssh://` 开头，于是下游
 * 的位置判断会把它当成本地项目，把远程会话的工具悄悄换成本地实现。
 *
 * `resolveLocal` 由调用方注入（通常是 `node:path` 的 `resolve`），本包因此不必关心
 * 宿主用的是哪套路径语义。
 */
export function normalizeProjectCwd(cwd: string, resolveLocal: (value: string) => string): string {
	if (!isSshProjectUri(cwd)) return resolveLocal(cwd);
	const location = parseProjectLocation(cwd);
	return formatProjectLocation(location);
}

/**
 * 去掉重复分隔符和结尾斜杠，保留开头的 `/`。
 *
 * 归一化必须在「进入主键」之前做一次并且只做这一次：`/srv/app` 与 `/srv/app/` 若被当成
 * 两个项目，用户会看到同一个目录在侧边栏出现两遍，各自带一半会话。
 */
export function normalizeRemotePath(path: string): string {
	const collapsed = path.replace(/\/{2,}/g, "/");
	if (collapsed.length > 1 && collapsed.endsWith("/")) {
		return collapsed.replace(/\/+$/, "");
	}
	return collapsed;
}

/** 远端路径大小写敏感，本地按 Desktop 既有约定大小写不敏感。 */
export function sameProjectLocation(first: string, second: string): boolean {
	const left = parseProjectLocation(first);
	const right = parseProjectLocation(second);
	if (left.kind !== right.kind) return false;
	if (left.kind === "local" && right.kind === "local") {
		return normalizeLocalPath(left.path) === normalizeLocalPath(right.path);
	}
	if (left.kind === "ssh" && right.kind === "ssh") {
		return left.hostId === right.hostId && left.remotePath === right.remotePath;
	}
	return false;
}

function normalizeLocalPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
