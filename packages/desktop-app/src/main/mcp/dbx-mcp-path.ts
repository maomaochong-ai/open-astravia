import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { McpConfigData, McpServerConfigData } from "../../preload/api-types/mcp.js";

/**
 * 占位符：内置 dbx 预设的 command 用它占位，写入 mcp.json 前由
 * expandDbxMcpCommand() 展开为 dbx-mcp 二进制绝对路径。
 */
export const DBX_MCP_COMMAND_PLACEHOLDER = "{{dbxMcpBin}}";

/**
 * dbx-mcp 原生二进制绝对路径（随包分发）。
 *
 * 来源：scripts/fetch-dbx-mcp.mjs 下载到 packages/desktop-app/resources/dbx-mcp/，
 * prepare-pack.js 经 extraResources 拷入 Resources/dbx-mcp/（打包后由
 * process.resourcesPath 解析；未打包走 process.cwd()/resources（dev 下
 * app.getAppPath() 指向 dist/main，不可靠，见 im-host/binary-resolver.ts 注释）。
 *
 * 平台：win32-x64 / darwin-arm64 / darwin-x64（linux-x64 预留，见
 * docs/database/dbx-main-integration-tasks.md）；macOS 二进制来源为官方 npm 平台包
 * （fork CI 产出 darwin 资产后切换，见 scripts/fetch-dbx-mcp.mjs）。
 */
function dbxMcpPlatformDir(): string {
	switch (`${process.platform}-${process.arch}`) {
		case "win32-x64":
			return "win32-x64";
		case "darwin-arm64":
			return "darwin-arm64";
		case "darwin-x64":
			return "darwin-x64";
		case "linux-x64":
			return "linux-x64";
		default:
			throw new Error(`dbx-mcp is not supported on platform ${process.platform}-${process.arch}`);
	}
}

export function resolveDbxMcpBinaryPath(): string {
	const platformDir = dbxMcpPlatformDir();
	const binaryName = process.platform === "win32" ? "dbx-mcp.exe" : "dbx-mcp";
	const expected = app.isPackaged
		? join(process.resourcesPath, "dbx-mcp", platformDir, binaryName)
		: join(process.cwd(), "resources", "dbx-mcp", platformDir, binaryName);
	if (!existsSync(expected)) {
		throw new Error(
			`dbx-mcp binary not found at ${expected}. Run \`bun run prepare:dbx-mcp\` in packages/desktop-app first.`,
		);
	}
	return expected;
}

/**
 * 把 mcp.json 配置里 stdio server 的 {{dbxMcpBin}} 占位符展开为绝对路径。
 * 无占位符时原样返回（避免无谓的对象重建）。
 */
export function expandDbxMcpCommand(config: McpConfigData): McpConfigData {
	let changed = false;
	const mcpServers: Record<string, McpServerConfigData> = {};
	for (const [name, server] of Object.entries(config.mcpServers)) {
		if (server.type !== "http" && server.command.includes(DBX_MCP_COMMAND_PLACEHOLDER)) {
			mcpServers[name] = { ...server, command: resolveDbxMcpBinaryPath() };
			changed = true;
		} else {
			mcpServers[name] = server;
		}
	}
	return changed ? { mcpServers } : config;
}
