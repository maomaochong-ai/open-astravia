/**
 * MCP 条目的安装位置解析。
 *
 * 这是纯函数：给定 scope、cwd 与「是否远程项目」，算出应该读写哪个文件，或给出
 * 一句能直接展示给用户的错误。服务层、审批卡与技能文档三处都必须对「什么算合法」
 * 给出同一个答案，所以规则只写在这里。
 */

export type McpInstallScope = "global" | "project";

export interface McpLocationInput {
	readonly scope?: McpInstallScope;
	readonly cwd?: string;
	/** 项目根是否为远程地址（`ssh://`）；远程项目不能装项目层。 */
	readonly isRemoteProject?: boolean;
	/** 本仓项目层配置目录名（`CONFIG_DIR_NAME`），由调用方注入，避免这里硬编码。 */
	readonly configDirName: string;
}

export type McpLocationResolution =
	| { readonly ok: true; readonly scope: McpInstallScope; readonly projectDir?: string }
	| { readonly ok: false; readonly error: string };

const PROJECT_SCOPE_MESSAGES = {
	missingCwd: "装到项目层需要指定项目根目录。",
	remote: "远程项目的配置文件不在这台机器上，只能装到全局。",
	notAbsolute: "项目根目录必须是本机绝对路径。",
} as const;

export function resolveMcpInstallLocation(input: McpLocationInput): McpLocationResolution {
	const scope = input.scope ?? "global";
	if (scope === "global") return { ok: true, scope };
	if (input.isRemoteProject) return { ok: false, error: PROJECT_SCOPE_MESSAGES.remote };
	const cwd = input.cwd?.trim();
	if (!cwd) return { ok: false, error: PROJECT_SCOPE_MESSAGES.missingCwd };
	// 相对路径在服务端解析出的位置取决于进程 cwd，用户看到的「项目」会随启动方式变化。
	if (!isAbsolutePath(cwd)) return { ok: false, error: PROJECT_SCOPE_MESSAGES.notAbsolute };
	return { ok: true, scope, projectDir: cwd };
}

/** 项目层配置文件路径：`<cwd>/<configDirName>/mcp.json`。 */
export function projectMcpConfigPath(projectDir: string, configDirName: string): string {
	return `${projectDir.replace(/[\\/]+$/, "")}/${configDirName}/mcp.json`;
}

function isAbsolutePath(value: string): boolean {
	// Windows 盘符、UNC 与 POSIX 绝对路径；不引入 node:path 让这个函数保持可在渲染层复用。
	return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}
