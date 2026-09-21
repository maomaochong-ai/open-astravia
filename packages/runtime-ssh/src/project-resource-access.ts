import { posix } from "node:path";
import type { NodeResourceAccess } from "@vetta/runtime-node/host";
import {
	formatSshProjectUri,
	isSshProjectUri,
	parseProjectLocation,
	type SshConnection,
	type SshProjectLocation,
} from "@vetta/ssh-transport";

/**
 * 按路径归属分发的资源访问端口：`ssh://<hostId>/…` 走远端，其余走本机。
 *
 * 一次会话的资源来自两台机器——项目自己的 AGENTS.md、项目技能在远端，用户级的技能、
 * 场景和全局上下文在本机。发现逻辑只认「路径」，所以让路径自己带上归属：远程项目的
 * cwd 本来就是 URI，由它派生出的每一条路径（向上找 AGENTS.md、拼 `.agents/skills`）
 * 都保持 URI 形态，到了读文件这一步再决定去哪台机器。
 *
 * 路径运算必须认得这个形态。交给 `node:path` 的话，`resolve("ssh://h/srv/app")` 会得到
 * `<本机进程 cwd>/ssh:/h/srv/app`，随后的向上遍历穿过**本机**的祖先目录，把本机的
 * AGENTS.md 和技能当成远端项目的规则注入会话。
 */
export function createProjectResourceAccess(
	local: NodeResourceAccess,
	resolveConnection: (hostId: string) => SshConnection,
): NodeResourceAccess {
	const remote = (path: string): { connection: SshConnection; location: SshProjectLocation } | undefined => {
		if (!isSshProjectUri(path)) return undefined;
		const location = parseProjectLocation(path);
		if (location.kind !== "ssh") return undefined;
		return { connection: resolveConnection(location.hostId), location };
	};

	return {
		files: {
			async stat(path, options) {
				const target = remote(path);
				if (!target) return local.files.stat(path, options);
				// 跟随符号链接：发现逻辑问的是「这里有没有一个能读的文件 / 目录」。
				const entry = await target.connection.stat(target.location.remotePath, options?.signal, {
					followSymlinks: true,
				});
				if (!entry) return undefined;
				return {
					kind: entry.kind === "file" || entry.kind === "directory" ? entry.kind : "other",
					modifiedAtMs: entry.modifiedAtSeconds * 1000,
					size: entry.sizeBytes,
				};
			},
			async readText(path, options) {
				const target = remote(path);
				if (!target) return local.files.readText(path, options);
				const bytes = await target.connection.readFile(target.location.remotePath, options?.signal);
				return new TextDecoder().decode(bytes);
			},
			async readDirectory(path, options) {
				const target = remote(path);
				if (!target) return local.files.readDirectory(path, options);
				const entries = await target.connection.listDirectory(target.location.remotePath, options?.signal);
				return entries.map((entry) => ({
					name: entry.name,
					kind: entry.kind === "file" || entry.kind === "directory" ? entry.kind : "other",
					symbolicLink: entry.kind === "symlink",
				}));
			},
			async realPath(path, options) {
				const target = remote(path);
				if (!target) return local.files.realPath(path, options);
				const resolved = await target.connection.realPath(target.location.remotePath, options?.signal);
				return formatSshProjectUri(target.location.hostId, resolved);
			},
		},
		paths: {
			separator: local.paths.separator,
			homeDirectory: local.paths.homeDirectory,
			basename: (path) => (isSshProjectUri(path) ? posix.basename(remotePathOf(path)) : local.paths.basename(path)),
			dirname: (path) =>
				isSshProjectUri(path) ? mapRemotePath(path, (value) => posix.dirname(value)) : local.paths.dirname(path),
			// URI 自带归属，对发现逻辑而言就是绝对路径；判成相对的话它会被拼到本机 cwd 后面。
			isAbsolute: (path) => isSshProjectUri(path) || local.paths.isAbsolute(path),
			join: (...parts) => {
				const [first, ...rest] = parts;
				if (first === undefined || !isSshProjectUri(first)) return local.paths.join(...parts);
				return mapRemotePath(first, (value) => posix.join(value, ...rest));
			},
			relative: (from, to) => {
				if (isSshProjectUri(from) && isSshProjectUri(to) && hostOf(from) === hostOf(to)) {
					return posix.relative(remotePathOf(from), remotePathOf(to));
				}
				// 跨机器没有相对路径可言，返回目标本身，调用方据此判断「不在其下」。
				if (isSshProjectUri(from) || isSshProjectUri(to)) return to;
				return local.paths.relative(from, to);
			},
			resolve: (...parts) => {
				// 与 `path.resolve` 同义：从右往左，遇到第一个绝对路径为止。
				for (let index = parts.length - 1; index >= 0; index--) {
					const part = parts[index];
					if (isSshProjectUri(part)) {
						return mapRemotePath(part, (value) => posix.resolve(value, ...parts.slice(index + 1)));
					}
					if (local.paths.isAbsolute(part)) break;
				}
				return local.paths.resolve(...parts);
			},
		},
	};
}

function hostOf(uri: string): string {
	const location = parseProjectLocation(uri);
	return location.kind === "ssh" ? location.hostId : "";
}

function remotePathOf(uri: string): string {
	const location = parseProjectLocation(uri);
	return location.kind === "ssh" ? location.remotePath : uri;
}

function mapRemotePath(uri: string, transform: (remotePath: string) => string): string {
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") return uri;
	return formatSshProjectUri(location.hostId, transform(location.remotePath));
}
