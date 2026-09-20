import type { EditOperations, LsOperations, ReadOperations, WriteOperations } from "@vetta/runtime-node/coding";
import type { SshConnection } from "@vetta/ssh-transport";

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

export function createSshReadOperations(connection: SshConnection): ReadOperations {
	const expand: Expand = (path) => connection.expandRemotePath(path);
	return {
		readFile: async (absolutePath) => Buffer.from(await connection.readFile(await expand(absolutePath))),
		access: async (absolutePath) => {
			const entry = await connection.stat(await expand(absolutePath));
			// 抛而不是返回 false：`access` 的语义就是「不可访问即抛」，读工具靠它区分
			// 「文件不存在」和「读到了空文件」。
			if (entry === null) throw new Error(`ENOENT: no such file or directory, access '${absolutePath}'`);
		},
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

export function createSshEditOperations(connection: SshConnection): EditOperations {
	const read = createSshReadOperations(connection);
	const write = createSshWriteOperations(connection);
	return {
		readFile: read.readFile,
		access: read.access,
		writeFile: write.writeFile,
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
