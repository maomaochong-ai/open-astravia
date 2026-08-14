/**
 * 输入框与用户气泡共用的「文本流 + 行内 token」表示。
 *
 * 文本形态（发给模型、也是会话里持久化的那份）：
 * - skill 软引用：`@skill:名字`（名字含空白或引号时 `@skill:"名字"`）
 * - scene 编辑态引用：`@scene:名字`；发送时转成 `PromptRequest.promptRef`，不进入模型正文
 * - 连接器（内置 MCP）软引用：`@mcp:名字`
 * - 文件 / 目录 / 图片：`@/abs/path`（含空白时 `@"/abs/path"`）
 *
 * 连接器刻意不用裸 `@notion`：那样无法与手敲的 `@某个词` 区分——文件 token 靠
 * 「是不是绝对路径」判定，而连接器名不是路径，只能靠命名空间前缀消歧。
 *
 * scene 与其他能力共用编辑器 Token；发送边界会把它从正文剥离并转换为唯一的
 * PromptRequest.promptRef，coding-agent 再注入 tasks.json 生成的 todo 并锁定列表。
 */

export type InputSegment =
	| { kind: "text"; text: string }
	| { kind: "skill"; name: string }
	| { kind: "scene"; name: string }
	| { kind: "connector"; name: string }
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
