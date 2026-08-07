import type { ProbeDefinition } from "./types";
import { errorMessage, isOutsideProject, isPermissionDenied, timedResult } from "./types";

/** Infer a user home directory from an absolute project path (renderer has no Node env). */
export function inferHomeFromProject(projectRoot: string | null): string | null {
	if (!projectRoot) return null;
	const normalized = projectRoot.replace(/\\/g, "/");
	const win = normalized.match(/^([A-Za-z]:\/Users\/[^/]+)/i);
	if (win) return win[1].replace(/\//g, "\\");
	const mac = normalized.match(/^(\/Users\/[^/]+)/);
	if (mac) return mac[1];
	const linux = normalized.match(/^(\/home\/[^/]+)/);
	if (linux) return linux[1];
	return null;
}

function joinHome(home: string, relative: string): string {
	const slash = home.includes("\\") ? "\\" : "/";
	return `${home.replace(/[\\/]+$/, "")}${slash}${relative.replace(/\//g, slash)}`;
}

function homeishPaths(projectRoot: string | null): string[] {
	const home = inferHomeFromProject(projectRoot);
	const paths = [
		home,
		home ? joinHome(home, ".vetta/plugins-manifest.json") : null,
		home ? joinHome(home, ".ssh/id_rsa") : null,
		"C:\\Windows\\System32\\drivers\\etc\\hosts",
		"/etc/hosts",
	].filter((value): value is string => Boolean(value));
	return Array.from(new Set(paths));
}

export const filesystemBoundaryProbes: ProbeDefinition[] = [
	{
		id: "fs.project-read",
		category: "文件系统边界",
		title: "项目根内 readDir（需 fs.read + 活动项目）",
		findingSeverity: "medium",
		run: (probe) =>
			timedResult(
				{
					id: "fs.project-read",
					category: "文件系统边界",
					title: "项目根内 readDir（需 fs.read + 活动项目）",
				},
				async () => {
					if (!probe.ctx.permissions.has("fs.read")) {
						return { status: "skip", severity: "info", summary: "需要 fs.read" };
					}
					if (!probe.projectRoot) {
						return {
							status: "skip",
							severity: "info",
							summary: "无活动项目 cwd，无法测项目内读",
						};
					}
					try {
						const entries = await probe.ctx.fs.readDir(probe.projectRoot);
						return {
							status: "pass",
							severity: "info",
							summary: `项目内 readDir 成功（${entries.length} 项）`,
							detail: entries
								.slice(0, 8)
								.map((e) => `${e.isDirectory ? "d" : "f"} ${e.name}`)
								.join("\n"),
						};
					} catch (error) {
						return {
							status: "error",
							severity: "medium",
							summary: "项目内 readDir 失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "fs.outside-write",
		category: "文件系统边界",
		title: "项目外 writeFile 应被拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "fs.outside-write",
					category: "文件系统边界",
					title: "项目外 writeFile 应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("fs.write")) {
						return { status: "skip", severity: "info", summary: "需要 fs.write" };
					}
					const home = inferHomeFromProject(probe.projectRoot);
					const target = home
						? joinHome(home, "security-probe-should-not-write.txt")
						: probe.projectRoot
							? `${probe.projectRoot.replace(/[\\/]+$/, "")}${probe.projectRoot.includes("\\") ? "\\" : "/"}..${probe.projectRoot.includes("\\") ? "\\" : "/"}security-probe-should-not-write.txt`
							: "C:\\security-probe-should-not-write.txt";
					try {
						await probe.ctx.fs.writeFile(target, "security-probe should not write here\n");
						return {
							status: "finding",
							severity: "critical",
							summary: "项目外 writeFile 成功 — 文件系统写边界失效",
							detail: target,
						};
					} catch (error) {
						if (isOutsideProject(error) || isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "项目外写入被拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "blocked",
							severity: "info",
							summary: "项目外写入失败（视为边界生效）",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "fs.homedir-preview-read",
		category: "文件系统边界",
		title: "用户主目录可读预览路径（assertPathReadableForPreview）",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "fs.homedir-preview-read",
					category: "文件系统边界",
					title: "用户主目录可读预览路径（assertPathReadableForPreview）",
				},
				async () => {
					if (!probe.ctx.permissions.has("fs.read")) {
						return { status: "skip", severity: "info", summary: "需要 fs.read" };
					}
					const outcomes: string[] = [];
					let anySuccess = false;
					let anySensitiveSuccess = false;
					for (const path of homeishPaths(probe.projectRoot)) {
						try {
							const result = await probe.ctx.fs.readFile(path);
							anySuccess = true;
							const sensitive = /id_rsa|plugins-manifest|\.ssh/i.test(path);
							if (sensitive) anySensitiveSuccess = true;
							outcomes.push(
								`${path} => READ ok encoding=${result.encoding} len=${result.content.length}`,
							);
						} catch (error) {
							outcomes.push(`${path} => ${errorMessage(error)}`);
						}
					}
					if (anySensitiveSuccess) {
						return {
							status: "finding",
							severity: "high",
							summary: "fs.read 下可读主目录敏感路径（预览策略宽于项目根）",
							detail: [
								"filesystem-service.assertPathReadableForPreview 允许整个 homedir，",
								"而写操作 assertFilesystemPathWithinProject 仅限项目根。",
								"获得 fs.read 的插件可读取 ~/.ssh、配置与凭证文件（若存在）。",
								"",
								...outcomes,
							].join("\n"),
						};
					}
					if (anySuccess) {
						return {
							status: "finding",
							severity: "medium",
							summary: "fs.read 可读取项目外/主目录部分路径",
							detail: outcomes.join("\n"),
						};
					}
					return {
						status: "blocked",
						severity: "info",
						summary: "主目录探测路径均不可读（环境限制或路径不存在）",
						detail: outcomes.join("\n"),
					};
				},
			),
	},
	{
		id: "fs.traversal-write",
		category: "文件系统边界",
		title: "经项目根的 .. 穿越写应被拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "fs.traversal-write",
					category: "文件系统边界",
					title: "经项目根的 .. 穿越写应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("fs.write")) {
						return { status: "skip", severity: "info", summary: "需要 fs.write" };
					}
					if (!probe.projectRoot) {
						return {
							status: "skip",
							severity: "info",
							summary: "无活动项目 cwd",
						};
					}
					const sep = probe.projectRoot.includes("\\") ? "\\" : "/";
					const target = `${probe.projectRoot}${sep}..${sep}security-probe-escape.txt`;
					try {
						await probe.ctx.fs.writeFile(target, "escape\n");
						return {
							status: "finding",
							severity: "critical",
							summary: "路径穿越写入成功",
							detail: target,
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "路径穿越写入被拒绝或解析后仍在边界内校验失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "fs.direct-host-bypass",
		category: "文件系统边界",
		title: "绕过 ctx：直接 window.vetta.fs.readFile",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "fs.direct-host-bypass",
					category: "文件系统边界",
					title: "绕过 ctx：直接 window.vetta.fs.readFile",
				},
				async () => {
					const hostFs = window.vetta?.fs;
					if (!hostFs || typeof hostFs.readFile !== "function") {
						return {
							status: "pass",
							severity: "info",
							summary: "window.vetta.fs.readFile 不可用",
						};
					}
					const target = probe.projectRoot ?? homeishPaths(probe.projectRoot)[0];
					if (!target) {
						return { status: "skip", severity: "info", summary: "无可用探测路径" };
					}
					try {
						const result = await hostFs.readFile(target);
						const stillHasCtxGate = !probe.ctx.permissions.has("fs.read");
						return {
							status: "finding",
							severity: stillHasCtxGate ? "critical" : "high",
							summary: stillHasCtxGate
								? "无 fs.read 授权仍可通过 window.vetta.fs 读文件"
								: "可通过 window.vetta.fs 直接读文件（绕过 plugin-sdk 封装）",
							detail: `target=${target}; resultType=${typeof result}`,
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "直接宿主 fs 调用失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
];
