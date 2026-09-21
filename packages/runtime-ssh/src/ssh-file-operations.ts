import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
	detectSupportedImageMimeTypeFromBuffer,
	detectSupportedImageMimeTypeFromFile,
	type EditOperations,
	IMAGE_SNIFF_BYTES,
	type LsOperations,
	type ReadOperations,
	type WriteOperations,
} from "@vetta/runtime-node/coding";
import { type SshConnection, SshHelperClosedError, SshHelperError } from "@vetta/ssh-transport";

/**
 * 把工具的文件端口接到一条 SSH 连接上。
 *
 * 工具本身的逻辑（schema、行号、截断、锚点编辑、路径策略）完全复用 runtime-node 的
 * 实现，这里只替换底层的读写。模型因此看到与本地完全一致的工具行为，只是作用在
 * 远端机器上。
 */
/**
 * `~` 由这里展开，而不是由工具的路径解析展开：那一步是同步的，拿不到远端家目录，
 * 只能把 `~/x` 原样递过来。所有命令都给路径加单引号，不展开的话 `'~'` 就是一个
 * 名叫 `~` 的目录。
 */
type Expand = (path: string) => Promise<string>;

export interface SshReadOperationsOptions {
	/**
	 * 本机上、远程会话也必须读得到的目录。
	 *
	 * 会话里有一类文件天然在本机：用户粘贴的图片、技能的参考资料、被截断的命令输出的完整
	 * 日志。宿主把它们的**本机路径**交给模型，模型再用 read 去读——项目在远端时，这条
	 * 路径在远端要么不存在，要么碰巧是另一份无关的文件。落在这些目录下的路径因此改读本机。
	 *
	 * 只影响 read。写入与命令始终作用在远端：这些目录由 Vetta 管理，模型不该往里写。
	 */
	readonly localReadRoots?: readonly string[];
}

export function createSshReadOperations(
	connection: SshConnection,
	options: SshReadOperationsOptions = {},
): ReadOperations {
	const expand: Expand = (path) => connection.expandRemotePath(path);
	const roots = (options.localReadRoots ?? []).filter((root) => isAbsolute(root)).map((root) => resolve(root));
	const isLocal = (path: string): boolean =>
		isAbsolute(path) &&
		roots.some((root) => {
			const offset = relative(root, resolve(path));
			return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
		});
	return {
		readFile: async (absolutePath) =>
			isLocal(absolutePath)
				? readFile(absolutePath)
				: Buffer.from(await connection.readFile(await expand(absolutePath))),
		access: async (absolutePath) => {
			if (isLocal(absolutePath)) {
				await access(absolutePath, constants.R_OK);
				return;
			}
			const entry = await connection.stat(await expand(absolutePath));
			// 抛而不是返回 false：`access` 的语义就是「不可访问即抛」，读工具靠它区分
			// 「文件不存在」和「读到了空文件」。
			if (entry === null) throw new Error(`ENOENT: no such file or directory, access '${absolutePath}'`);
		},
		// 缺了它，read 会把远端的每张图片都当成二进制文件拒掉。
		detectImageMimeType: async (absolutePath) =>
			isLocal(absolutePath)
				? detectSupportedImageMimeTypeFromFile(absolutePath)
				: detectSupportedImageMimeTypeFromBuffer(
						await connection.readFileHead(await expand(absolutePath), IMAGE_SNIFF_BYTES),
					),
	};
}

export function createSshWriteOperations(connection: SshConnection): WriteOperations {
	const expand: Expand = (path) => connection.expandRemotePath(path);
	return {
		writeFile: async (absolutePath, content) => {
			await connection.writeFile(await expand(absolutePath), new TextEncoder().encode(content));
		},
		mkdir: async (directory) => {
			await connection.makeDirectory(await expand(directory));
		},
	};
}

/**
 * edit 是「读—改—写」：读回来的内容在本机改完再整份写回去。远端的这个窗口比本地长得多
 * （两次网络往返，中间还隔着模型的一次思考），期间文件被别人改掉的话，整份写回会把对方的
 * 修改悄悄盖掉。
 *
 * 远端有 helper 时写入带上读取那一刻的内容摘要，由 helper 在同一台机器上原子地核对：对不上
 * 就拒绝，让模型重新读。没有 helper 时退回无条件写——与引入 helper 之前一致。
 */
export function createSshEditOperations(connection: SshConnection): EditOperations {
	const read = createSshReadOperations(connection);
	const write = createSshWriteOperations(connection);
	const revisions = new Map<string, string>();
	const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
	return {
		readFile: async (absolutePath) => {
			const content = await read.readFile(absolutePath);
			revisions.set(absolutePath, digest(content));
			return content;
		},
		access: read.access,
		writeFile: async (absolutePath, content) => {
			const bytes = new TextEncoder().encode(content);
			const expectedRevision = revisions.get(absolutePath);
			const helper = expectedRevision ? await connection.helper().catch(() => undefined) : undefined;
			if (!helper || helper.isClosed || !expectedRevision) {
				await write.writeFile(absolutePath, content);
			} else {
				try {
					await helper.call("fs.writeFile", {
						path: await connection.expandRemotePath(absolutePath),
						data: Buffer.from(bytes).toString("base64"),
						expectedRevision,
					});
				} catch (error) {
					if (error instanceof SshHelperError && error.code === "ECONFLICT") {
						revisions.delete(absolutePath);
						throw new Error(
							`${absolutePath} was modified on the remote host after it was read. ` +
								"Read the file again and re-apply the edit to its current content.",
						);
					}
					// 通道断了：没问到，不代表写入失败，也不代表成功——退回无条件写。
					if (!(error instanceof SshHelperClosedError)) throw error;
					await write.writeFile(absolutePath, content);
				}
			}
			revisions.set(absolutePath, digest(bytes));
		},
	};
}

export function createSshLsOperations(connection: SshConnection): LsOperations {
	const expand: Expand = (path) => connection.expandRemotePath(path);
	return {
		exists: async (absolutePath) => (await connection.stat(await expand(absolutePath))) !== null,
		stat: async (absolutePath) => {
			const entry = await connection.stat(await expand(absolutePath));
			if (entry === null) throw new Error(`ENOENT: no such file or directory, stat '${absolutePath}'`);
			const isDirectory = entry.kind === "directory";
			return { isDirectory: () => isDirectory };
		},
		readdir: async (absolutePath) =>
			(await connection.listDirectory(await expand(absolutePath))).map((entry) => entry.name),
	};
}
