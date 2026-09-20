import type { EditOperations, LsOperations, ReadOperations, WriteOperations } from "@vetta/runtime-node/coding";
import type { SshConnection } from "@vetta/ssh-transport";

/**
 * 把工具的文件端口接到一条 SSH 连接上。
 *
 * 工具本身的逻辑（schema、行号、截断、锚点编辑、路径策略）完全复用 runtime-node 的
 * 实现，这里只替换底层的读写。模型因此看到与本地完全一致的工具行为，只是作用在
 * 远端机器上。
 */
export function createSshReadOperations(connection: SshConnection): ReadOperations {
	return {
		readFile: async (absolutePath) => Buffer.from(await connection.readFile(absolutePath)),
		access: async (absolutePath) => {
			const entry = await connection.stat(absolutePath);
			// 抛而不是返回 false：`access` 的语义就是「不可访问即抛」，读工具靠它区分
			// 「文件不存在」和「读到了空文件」。
			if (entry === null) throw new Error(`ENOENT: no such file or directory, access '${absolutePath}'`);
		},
	};
}

export function createSshWriteOperations(connection: SshConnection): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			await connection.writeFile(absolutePath, new TextEncoder().encode(content));
		},
		mkdir: async (directory) => {
			await connection.makeDirectory(directory);
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
	return {
		exists: async (absolutePath) => (await connection.stat(absolutePath)) !== null,
		stat: async (absolutePath) => {
			const entry = await connection.stat(absolutePath);
			if (entry === null) throw new Error(`ENOENT: no such file or directory, stat '${absolutePath}'`);
			const isDirectory = entry.kind === "directory";
			return { isDirectory: () => isDirectory };
		},
		readdir: async (absolutePath) => (await connection.listDirectory(absolutePath)).map((entry) => entry.name),
	};
}
