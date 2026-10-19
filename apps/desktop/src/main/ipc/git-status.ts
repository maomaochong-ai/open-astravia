import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 单条 git status 记录的 XY 状态。
 * X 是暂存区状态，Y 是工作区状态；未跟踪文件为 "??"。
 */
export interface GitStatusEntry {
	/** 工作区相对路径（git 输出原样，通常用 / 分隔）。 */
	path: string;
	/** 两字符状态码，例如 " M"、"M "、"??"、"A "、" D"。 */
	status: string;
}

/**
 * 在指定目录运行 `git status --porcelain=v1 -z`，返回路径→状态映射。
 *
 * - 非 git 仓库或 git 不可用时返回空 Map（不抛错，调用方按"无修改"处理）。
 * - 用 -z 分隔，路径可含空格与换行；解析时按 NUL 切分。
 * - rename/copy 记录含 "orig -> new"，此处只取目标路径。
 */
export async function getGitStatus(cwd: string): Promise<Map<string, GitStatusEntry>> {
	const result = new Map<string, GitStatusEntry>();
	let stdout: string;
	try {
		const out = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
			cwd,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});
		stdout = out.stdout;
	} catch {
		// 非 git 仓库、git 未安装或命令失败：当作无修改。
		return result;
	}

	if (!stdout) return result;

	// -z 输出：每条记录以 NUL 结尾。rename/copy 记录为 "XY ORIG\0NEW\0"，
	// 即状态码后跟原始路径，再 NUL 分隔新路径。
	const parts = stdout.split("\0");
	for (let i = 0; i < parts.length; i++) {
		const field = parts[i];
		if (!field) continue;
		const match = field.match(/^([ MADRCU?!]{2}) (.*)$/);
		if (!match) continue;
		const status = match[1];
		const firstPath = match[2];
		// R 或 C 状态：下一个非空字段是新路径。
		if ((status[0] === "R" || status[0] === "C") && i + 1 < parts.length && parts[i + 1]) {
			const newPath = parts[i + 1];
			i++; // 跳过新路径字段
			result.set(newPath, { path: newPath, status });
			result.set(firstPath, { path: firstPath, status: "D " }); // 原路径标记为已删除
		} else {
			result.set(firstPath, { path: firstPath, status });
		}
	}
	return result;
}

/** 判断状态是否表示工作区或暂存区有修改（含未跟踪、已修改、已暂存、删除、重命名）。 */
export function isGitStatusModified(status: string): boolean {
	if (status === "??") return true;
	const [x, y] = status;
	return (x !== " " && x !== "?") || (y !== " " && y !== "?");
}

/**
 * 把 git 两字符状态映射为文件树装饰色。
 * - 未跟踪(??) / 已添加(A)：success（绿）
 * - 已修改(M) / 重命名(R) / 复制(C)：warning（琥珀）
 * - 已删除(D)：error（红）
 */
export function gitStatusToDecorationColor(status: string): "success" | "warning" | "error" | null {
	if (status === "??" || status.includes("A")) return "success";
	if (status.includes("D")) return "error";
	if (status.includes("M") || status.includes("R") || status.includes("C")) return "warning";
	return null;
}
