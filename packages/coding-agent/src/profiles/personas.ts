/**
 * 个性化「人设」预设注册表（personalization persona registry）。
 *
 * 唯一编辑来源：`src/profiles/personas/*.md`（一人设一个 md，frontmatter 存
 * id / label / description，正文存提示词，英文撰写）。构建期由
 * `scripts/generate-personas.mjs` 内联生成本目录的 `personas-data.ts`（见 FILE_PERSONAS），
 * 运行时零文件系统依赖——因为 coding-agent 会被 desktop 打进 bundle，
 * 运行时读盘的 __dirname 会失效。settings.json 只存 personaId；desktop 经 IPC
 * 拉本清单渲染选择器，避免前后端漂移。
 *
 * 新增人设 = 往该目录加一个 md（文件名排序决定展示顺序）后重新构建。
 * `default`（no-op、无正文）不落 md，在此合成并永远置顶。
 */

import { FILE_PERSONAS } from "./personas-data.js";

export interface Persona {
	/** 稳定标识，写入 settings.json personalization.personaId */
	id: string;
	/** UI 展示名 */
	label: string;
	/** UI 展示的一句话描述 */
	description: string;
	/** 追加进系统提示词的正文；默认人设为空字符串表示 no-op */
	prompt: string;
}

/** 默认人设 id：不追加任何文本，行为与未开启个性化完全一致。 */
export const DEFAULT_PERSONA_ID = "default";

const DEFAULT_PERSONA: Persona = {
	id: DEFAULT_PERSONA_ID,
	label: "默认",
	description: "不追加任何人设，保持 agent 原始行为",
	prompt: "",
};

export const PERSONAS: Persona[] = [DEFAULT_PERSONA, ...FILE_PERSONAS.filter((p) => p.id !== DEFAULT_PERSONA_ID)];

/** 按 id 解析人设提示词正文；未知 id 或默认人设返回空字符串。 */
export function getPersonaPrompt(id: string | undefined): string {
	return PERSONAS.find((p) => p.id === id)?.prompt ?? "";
}
