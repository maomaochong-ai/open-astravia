import { posix } from "node:path";
import { formatSshProjectUri, normalizeRemotePath, parseProjectLocation } from "@vetta/ssh-transport";
import {
	FILE_EXPLORER_ENTRY_EXISTS_ERROR,
	getFileExplorerEntryNameIssue,
} from "../../preload/file-explorer-entry-name.js";
import {
	type FileExplorerEntryKind,
	FS_EDITABLE_TEXT_ERROR,
	type FsEditableTextSnapshot,
	type FsEntry,
	type FsFileRef,
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
import type { PreviewFileSource } from "./preview-file-source.js";

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
	// 前缀比较看不出 `..`：`<项目>/../../etc/passwd` 字面上仍以项目根开头。合法调用方给的
	// 都是文件树里点出来的路径，不会带 `..`，直接拒绝比在这里模拟远端的路径解析可靠。
	if (split(uri).remotePath.split("/").includes("..")) {
		throw new Error("Path is outside any known project directory");
	}
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

/** 预览读取的远端字节来源，见 filesystem-service 的 {@link PreviewFileSource}。 */
export function openRemotePreviewSource(uri: string): PreviewFileSource {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	return {
		path: remotePath,
		stat: async () => {
			// 跟随符号链接：预览的是链接指向的内容。
			const entry = await connection.stat(remotePath, undefined, { followSymlinks: true });
			return entry ? { size: entry.sizeBytes, isFile: entry.kind === "file" } : null;
		},
		read: async () => Buffer.from(await connection.readFile(remotePath)),
		readHead: async (byteCount) => Buffer.from(await connection.readFileHead(remotePath, byteCount)),
	};
}

export async function writeRemoteFile(uri: string, content: Buffer): Promise<void> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	await connection.makeDirectory(posix.dirname(remotePath));
	await connection.writeFile(remotePath, content);
}

export async function renameRemotePath(oldUri: string, newUri: string): Promise<void> {
	assertRemotePathWithinProject(oldUri);
	assertRemotePathWithinProject(newUri);
	const from = split(oldUri);
	const to = split(newUri);
	assertSameHost(from.hostId, to.hostId);
	await getSshConnection(from.hostId).rename(from.remotePath, to.remotePath);
}

export async function deleteRemotePath(uri: string): Promise<void> {
	assertRemotePathWithinProject(uri);
	// 项目根本身不能从文件树里删：那等于远程执行 rm -rf <项目>。
	if (allowedRemoteRoots.has(normalizeRemoteUri(uri))) throw new Error("Refusing to delete the project root");
	const { hostId, remotePath } = split(uri);
	await getSshConnection(hostId).remove(remotePath);
}

export async function moveRemotePath(sourceUri: string, destinationDirectoryUri: string): Promise<void> {
	assertRemotePathWithinProject(sourceUri);
	assertRemotePathWithinProject(destinationDirectoryUri);
	const source = split(sourceUri);
	const destination = split(destinationDirectoryUri);
	assertSameHost(source.hostId, destination.hostId);
	const target = posix.join(destination.remotePath, posix.basename(source.remotePath));
	// 本机实现用 rename，目标已存在时会覆盖文件、对非空目录报错；远端的 mv 会把源**移进**
	// 同名目录里。两边行为对不齐，干脆在目标已存在时拒绝。
	if (await getSshConnection(source.hostId).stat(target)) throw new Error(FILE_EXPLORER_ENTRY_EXISTS_ERROR);
	await getSshConnection(source.hostId).rename(source.remotePath, target);
}

export async function createRemoteDirectory(uri: string): Promise<void> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	await getSshConnection(hostId).makeDirectory(remotePath);
}

export async function createRemoteEntry(
	parentUri: string,
	name: string,
	kind: FileExplorerEntryKind,
): Promise<FsEntry> {
	assertRemotePathWithinProject(parentUri);
	// 远端一律按 POSIX 规则校验名字，与本机是不是 Windows 无关。
	const issue = getFileExplorerEntryNameIssue(name, { windows: false });
	if (issue) throw new Error(`FILE_EXPLORER_INVALID_ENTRY_NAME:${issue}`);
	const { hostId, remotePath } = split(parentUri);
	const targetPath = posix.join(remotePath, name);
	if (posix.dirname(targetPath) !== normalizeRemotePath(remotePath)) {
		throw new Error("FILE_EXPLORER_INVALID_ENTRY_NAME:path-separator");
	}
	const connection = getSshConnection(hostId);
	if ((await connection.createEntry(targetPath, kind)) === "exists") throw new Error(FILE_EXPLORER_ENTRY_EXISTS_ERROR);
	const entry = await connection.stat(targetPath);
	return {
		name,
		path: formatSshProjectUri(hostId, targetPath),
		isDirectory: kind === "directory",
		size: entry?.sizeBytes ?? 0,
		modifiedAt: (entry?.modifiedAtSeconds ?? 0) * 1000,
	};
}

export async function listRemoteFilesRecursive(
	rootUri: string,
	options: { readonly ignoredDirectoryNames: readonly string[]; readonly limit: number },
): Promise<FsFileRef[]> {
	assertRemotePathWithinProject(rootUri);
	const { hostId, remotePath } = split(rootUri);
	const relativePaths = await getSshConnection(hostId).listFilesRecursive(remotePath, options);
	return relativePaths.map((relPath) => ({
		name: posix.basename(relPath),
		path: formatSshProjectUri(hostId, posix.join(remotePath, relPath)),
		relPath,
	}));
}

function assertSameHost(first: string, second: string): void {
	if (first !== second) throw new Error("Cannot move files between different remote hosts");
}

/** 远端媒体按这个粒度分块取回：一块一次往返，太小拖慢播放，太大让拖动进度条变迟钝。 */
const REMOTE_MEDIA_CHUNK_BYTES = 1024 * 1024;

export interface RemoteMediaSource {
	/** 远端路径，用来取扩展名判断 Content-Type。 */
	readonly path: string;
	readonly size: number;
	/** `[start, end]` 闭区间，与 HTTP Range 同义。 */
	stream(start: number, end: number): ReadableStream<Uint8Array>;
}

/** 媒体协议的远端字节来源；路径不存在或不是文件时返回 null。 */
export async function openRemoteMediaSource(uri: string): Promise<RemoteMediaSource | null> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	const entry = await connection.stat(remotePath, undefined, { followSymlinks: true });
	if (!entry || entry.kind !== "file") return null;
	return {
		path: remotePath,
		size: entry.sizeBytes,
		stream(start, end) {
			let offset = start;
			return new ReadableStream<Uint8Array>({
				// 按需取块：播放器暂停或跳走时不会继续把后面的内容拖过网络。
				async pull(controller) {
					if (offset > end) {
						controller.close();
						return;
					}
					const length = Math.min(REMOTE_MEDIA_CHUNK_BYTES, end - offset + 1);
					const chunk = await connection.readFileRange(remotePath, offset, length);
					if (chunk.byteLength === 0) {
						controller.close();
						return;
					}
					offset += chunk.byteLength;
					controller.enqueue(chunk);
				},
			});
		},
	};
}
