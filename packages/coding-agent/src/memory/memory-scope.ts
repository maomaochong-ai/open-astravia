/**
 * 记忆作用域：`user` 跨项目与对话共享，`project` 绑定当前工作目录（issue #8）。
 *
 * 作用域词汇被系统提示词渲染与 `memory` 工具 schema 共用，因此单独成模块，不放进
 * 文档解析或运行时合同。
 */
export type MemoryScope = "user" | "project";

/**
 * 缺省写入作用域。跨会话的持久事实（用户偏好、协作约定）比单个目录更常见，默认落
 * `user`；只有明确属于当前仓库的事实才写 `project`。
 */
export const DEFAULT_MEMORY_SCOPE: MemoryScope = "user";

/** 各作用域的语义说明，供系统提示词与 `memory` 工具描述共用。 */
export const MEMORY_SCOPE_GUIDANCE: Record<MemoryScope, string> = {
	user: "durable facts about the user and your standing agreements with them; shared across every project and conversation.",
	project: "facts about this working directory; shared by every session running in it.",
};
