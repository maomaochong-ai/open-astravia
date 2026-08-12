/**
 * 工作模式专用系统提示词解析。见 ADR-0046、ADR-0071。
 *
 * 唯一编辑来源：`src/profiles/modes/*.md`（frontmatter 存 id/label/description/icon，正文存提示词，英文撰写）。
 * 构建期由 `scripts/generate-modes.mjs` 内联生成本目录的 `modes-data.ts`，运行时零文件系统依赖
 * （coding-agent 会被 desktop 打进 bundle，运行时读盘的 __dirname 会失效）。
 *
 * 与 persona 正交：mode 提示词作为独立 `mode` block 注入，用户仍可另选 persona。
 */

import { FILE_MODES } from "./modes-data.js";

export interface ModePromptInfo {
	id: string;
	label: string;
	description: string;
	/** iconify class，供宿主 UI 遍历注册表渲染模式入口。 */
	icon: string;
	/** 渲染层能力位：staged = 会话流按 progress 阶段折叠；inline = 工具行内联展示。 */
	narration: "staged" | "inline";
	prompt: string;
}

export const MODE_PROMPTS: ModePromptInfo[] = FILE_MODES;

/** 按模式 id 解析专用提示词正文；未知/未传 id 返回空字符串（= 不追加 mode block）。 */
export function getModePrompt(mode: string | undefined): string {
	if (!mode) return "";
	return MODE_PROMPTS.find((m) => m.id === mode)?.prompt ?? "";
}
