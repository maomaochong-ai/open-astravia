import { parseActionCliCommand } from "../cli/action-command.js";
import { parseAgentRpcCommand } from "../cli/agent-rpc-command.js";
import { parseHelpCliCommand } from "../cli/help-command.js";
import { parseOcrCliCommand } from "../cli/ocr-command.js";
import { parsePdfCliCommand } from "../cli/pdf-command.js";

// 进程角色用于隔离日志文件：GUI 主进程与各 sidecar/CLI 子进程不再共写同一份
// 日志文件，消除多进程并发追加与归档 rename 的竞态。判别顺序与 main.ts 顶层
// 完全一致（ocr > action > pdf > help > agent-rpc），直接复用同一批 parser，
// 避免与启动分支判定不一致。cli 模块不反向 import logger，无循环依赖。
export type ProcessRole = "gui" | "agent-rpc" | "ocr-cli" | "pdf-cli" | "action-cli" | "help-cli";

let cachedRole: ProcessRole | undefined;

export function detectProcessRole(): ProcessRole {
	if (cachedRole !== undefined) return cachedRole;
	cachedRole = computeRole(process.argv);
	return cachedRole;
}

function computeRole(argv: string[]): ProcessRole {
	if (parseOcrCliCommand(argv)) return "ocr-cli";
	if (parseActionCliCommand(argv)) return "action-cli";
	if (parsePdfCliCommand(argv)) return "pdf-cli";
	if (parseHelpCliCommand(argv)) return "help-cli";
	if (parseAgentRpcCommand(argv)) return "agent-rpc";
	return "gui";
}

// GUI 不带后缀，保持现有 `<日期>.log` 习惯与向后兼容；其余角色带 role+pid，
// 不同进程文件名互不重叠（归档 rename 目标也因此互不碰撞）。
export function roleFileSuffix(role: ProcessRole): string {
	return role === "gui" ? "" : `.${role}.${process.pid}`;
}
