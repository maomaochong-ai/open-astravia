import type { SessionExecutionMode } from "@vetta/runtime-core";

export type ExecutionModeOverride = "inherit" | SessionExecutionMode;

export interface ProjectEntry {
	path: string;
	name?: string;
}

/**
 * 选中的技能/场景。会话页、批量任务、自动化共用同一种结构；
 * 执行时由各自的 executor 在 prompt 前拼 `/skill:name\n` 或 `/scene:name\n`。
 */
export interface SelectedSkillRef {
	name: string;
	alias?: string;
	type: "skill" | "scene";
}
