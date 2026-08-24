/**
 * 工作模式注册表（ADR-0071）。
 *
 * 唯一编辑来源：`modes/*.md`（frontmatter 存 id/label/description/icon/narration，正文存提示词，
 * 英文撰写）。构建期由 `scripts/build-agent-modes.mjs` 内联生成同目录的 `modes-data.ts`，
 * 运行时零文件系统依赖（main 进程由 vite 打成单 bundle，运行时读盘的 __dirname 会失效）。
 *
 * 归属在 desktop 而非 coding-agent：模式是桌面产品的概念——新会话页的 toggle、会话流的叙事
 * 折叠方式（narration）、toggle 图标（icon）都只对桌面有意义，CLI 与 SDK 宿主不传 agentMode。
 * coding-agent 只保留一个 `core.mode` block 槽位，正文由宿主经 `resolveModePrompt` 注入。
 *
 * 与 persona 正交：mode 提示词作为独立 `mode` block 注入，用户仍可另选 persona。
 */

import { FILE_MODES } from "./modes-data.js";

/**
 * 合法工作模式 id。跨进程边界（IPC、preload、renderer）退化为 string + 运行时校验，
 * 只有 main 进程内部拿得到这个收敛后的联合类型。
 */
export type AgentMode = (typeof FILE_MODES)[number]["id"];

export interface ModePromptInfo {
	id: AgentMode;
	label: string;
	description: string;
	/** iconify class，供新会话页遍历注册表渲染模式入口。 */
	icon: string;
	/** 渲染层能力位：staged = 会话流按 progress 阶段折叠；inline = 工具行内联展示。 */
	narration: "staged" | "inline";
	prompt: string;
}

export const MODE_PROMPTS: readonly ModePromptInfo[] = FILE_MODES;

export const ALL_AGENT_MODES: readonly AgentMode[] = FILE_MODES.map((mode) => mode.id);

/** 出厂默认模式，也是所有校验失败与历史会话缺记录时的回落值。 */
export const DEFAULT_AGENT_MODE: AgentMode = "work";

export function isAgentMode(value: unknown): value is AgentMode {
	return typeof value === "string" && (ALL_AGENT_MODES as readonly string[]).includes(value);
}

/** 按模式 id 解析专用提示词正文；未知 / 未传 id 返回空字符串（= 不追加 mode block）。 */
export function getModePrompt(mode: string | undefined): string {
	if (!mode) return "";
	return MODE_PROMPTS.find((m) => m.id === mode)?.prompt ?? "";
}
