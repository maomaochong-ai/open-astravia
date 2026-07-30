/**
 * 输入框与用户气泡共用的「文本流 + 行内 token」表示。
 *
 * 文本形态（发给模型、也是会话里持久化的那份）：
 * - skill 软引用：`@skill:名字`（名字含空白或引号时 `@skill:"名字"`）
 * - 文件 / 目录 / 图片：`@/abs/path`（含空白时 `@"/abs/path"`）
 *
 * scene 不出现在文本里：它仍走 PromptRequest.promptRef 硬展开
 * （coding-agent 侧会注入 tasks.json 生成的 todo 并锁定列表）。
 */

export type InputSegment =
	| { kind: "text"; text: string }
	| { kind: "skill"; name: string }
	| { kind: "file"; path: string; isDirectory?: boolean }
	| { kind: "image"; path: string };

/** 旧会话里以行首前缀承载的结构化引用（`/skill:name` / `/scene:name`）。 */
export interface LegacyPromptRef {
	kind: "skill" | "scene";
	name: string;
}

export interface ParsedInput {
	segments: InputSegment[];
	/** 仅旧格式会产出；新格式的 skill 走 segments、scene 走 promptRef 字段。 */
	legacyRef: LegacyPromptRef | null;
}
