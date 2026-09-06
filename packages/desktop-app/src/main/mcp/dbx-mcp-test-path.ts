import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 集成测试专用：跨平台解析真实 dbx-mcp 二进制路径。
 *
 * 背景：database-service / schema-context-injection 等集成测试需要真实 spawn
 * dbx-mcp 二进制。早期实现直接在 vi.mock 里硬编码 Windows 绝对路径
 * （E:/open-source-projects/.../win32-x64/dbx-mcp.exe），导致 macOS/Linux 上
 * spawn ENOENT、整文件 setup 失败并连坐纯函数用例。
 *
 * 本 helper 与 dbx-mcp-path.ts 的平台目录规则保持一致，但从 process.cwd()
 * 向上逐层探测（含 packages/desktop-app 嵌套），因此从包目录、仓库根或 CI
 * 任意工作目录启动都能命中随包分发的二进制；找不到时返回 null，由测试侧
 * describe.skipIf 优雅跳过集成套件（而非让 setup 抛错连坐纯函数用例）。
 *
 * 用法（测试文件内，配合 electron mock）：
 *   vi.mock("../mcp/dbx-mcp-path.js", async () => {
 *     const { resolveTestDbxMcpBinaryPath } = await import("../mcp/dbx-mcp-test-path.js");
 *     return { resolveDbxMcpBinaryPath: resolveTestDbxMcpBinaryPath };
 *   });
 */
export function findTestDbxMcpBinaryPath(): string | null {
	const platformDir = testDbxMcpPlatformDir();
	if (!platformDir) return null;
	const name = process.platform === "win32" ? "dbx-mcp.exe" : "dbx-mcp";
	let current = process.cwd();
	for (let depth = 0; depth < 8; depth++) {
		for (const sub of ["", "packages/desktop-app"]) {
			const candidate = join(current, sub, "resources", "dbx-mcp", platformDir, name);
			if (existsSync(candidate)) return candidate;
		}
		const parent = join(current, "..");
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

export function resolveTestDbxMcpBinaryPath(): string {
	const found = findTestDbxMcpBinaryPath();
	if (!found) {
		throw new Error(
			`dbx-mcp binary not found (searched upward from ${process.cwd()}). Run \`bun run prepare:dbx-mcp\` in packages/desktop-app first.`,
		);
	}
	return found;
}

function testDbxMcpPlatformDir(): string | null {
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
			// 平台无预编译资产（或 linux 资产未分发）：集成套件应跳过而非报错
			return null;
	}
}
