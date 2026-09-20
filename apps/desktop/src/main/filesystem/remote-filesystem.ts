import { formatSshProjectUri, normalizeRemotePath, parseProjectLocation } from "@vetta/ssh-transport";
import {
	FS_EDITABLE_TEXT_ERROR,
	type FsEditableTextSnapshot,
	type FsEntry,
	type FsSaveEditableTextOptions,
	type FsSaveEditableTextResult,
	type FsStatResult,
} from "../../preload/fs-types.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import {
	decodeEditableText,
	encodeEditableText,
	getFileRevision,
	MAX_EDITABLE_TEXT_FILE_SIZE,
} from "./editable-text.js";

/**
 * 远程项目的文件读写。
 *
 * 授权根与本地那套分开维护：本地用 `resolve()` 归一化并按本机大小写规则比较，
 * 远端路径永远是 POSIX 且大小写敏感，混在一起会让 `/srv/App` 和 `/srv/app`
 * 互相授权。键是完整的 `ssh://<hostId>/<路径>`，所以主机也天然参与了比较。
 */
const allowedRemoteRoots = new Set<string>();

export function allowRemoteProjectRoot(projectUri: string): void {
	allowedRemoteRoots.add(normalizeRemoteUri(projectUri));
}

function assertRemotePathWithinProject(uri: string): void {
	const target = normalizeRemoteUri(uri);
	for (const root of allowedRemoteRoots) {
		if (target === root || target.startsWith(`${root}/`)) return;
	}
	throw new Error("Path is outside any known project directory");
}

/** 归一化远端 URI，去掉重复斜杠与结尾斜杠，保证前缀比较不会因写法不同而失效。 */
function normalizeRemoteUri(uri: string): string {
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") throw new Error(`Not a remote path: ${uri}`);
	return formatSshProjectUri(location.hostId, location.remotePath);
}

function split(uri: string): { hostId: string; remotePath: string } {
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") throw new Error(`Not a remote path: ${uri}`);
	return { hostId: location.hostId, remotePath: location.remotePath };
}

const HIDDEN_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export async function readRemoteDirectory(uri: string): Promise<FsEntry[]> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const entries = await getSshConnection(hostId).listDirectory(remotePath);
	const results: FsEntry[] = [];
	for (const entry of entries) {
		if (HIDDEN_FILES.has(entry.name) || entry.name.startsWith(".")) continue;
		results.push({
			name: entry.name,
			// 回给渲染进程的仍是 URI：文件树拿它继续展开下一层，也用它做选中态的 key。
			path: formatSshProjectUri(hostId, `${normalizeRemotePath(remotePath)}/${entry.name}`),
			isDirectory: entry.kind === "directory",
			size: entry.sizeBytes,
			// 远端给的是秒，本地这套接口一律用毫秒。
			modifiedAt: entry.modifiedAtSeconds * 1000,
		});
	}
	results.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
	return results;
}

export async function statRemotePath(uri: string): Promise<FsStatResult | null> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const entry = await getSshConnection(hostId).stat(remotePath);
	if (!entry) return null;
	return {
		size: entry.sizeBytes,
		modifiedAt: entry.modifiedAtSeconds * 1000,
		// 远端的 stat 不回创建时间：Linux 上多数文件系统根本不记录它。
		// 用修改时间兜底，而不是给 0——0 会被界面显示成 1970 年。
		createdAt: entry.modifiedAtSeconds * 1000,
	};
}

export async function readRemoteEditableTextFile(uri: string): Promise<FsEditableTextSnapshot> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	const entry = await connection.stat(remotePath);
	if (!entry) throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_FILE);
	if (entry.kind === "directory") throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_FILE);
	// 先按远端报的大小挡一次，避免把一个几百兆的文件整个拖过网络再拒绝。
	if (entry.sizeBytes > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	const buffer = Buffer.from(await connection.readFile(remotePath));
	if (buffer.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	return {
		...decodeEditableText(buffer),
		revision: getFileRevision(buffer),
		size: buffer.byteLength,
		modifiedAt: entry.modifiedAtSeconds * 1000,
	};
}

export async function saveRemoteEditableTextFile(
	uri: string,
	content: string,
	options: FsSaveEditableTextOptions,
): Promise<FsSaveEditableTextResult> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	// 覆盖前重新读一遍算修订号：这是「别人动过没有」的唯一依据，不能用打开时的快照。
	const current = Buffer.from(await connection.readFile(remotePath));
	const currentRevision = getFileRevision(current);
	if (!options.force && currentRevision !== options.expectedRevision) {
		return { status: "conflict", revision: currentRevision };
	}

	const nextBuffer = encodeEditableText(content, options.hasBom);
	if (nextBuffer.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	await connection.writeFile(remotePath, nextBuffer);
	const entry = await connection.stat(remotePath);
	return {
		status: "saved",
		revision: getFileRevision(nextBuffer),
		size: nextBuffer.byteLength,
		modifiedAt: (entry?.modifiedAtSeconds ?? 0) * 1000,
	};
}
