/**
 * 对话场景 slug——决定一个工具 / 会话页插槽在哪些类型的会话里激活或可见。
 *
 * 本类型在 plugin-sdk 内本地定义（SDK 零依赖，不引入宿主包），与宿主
 * `@astravia/coding-agent` 的 `ConversationScenario` 保持一一对应；任一侧增删场景时两边须同步，
 * 否则宿主回传的 scenario 与此 union 不一致会触发编译错误（即为期望的漂移护栏）。
 */
export type ConversationScenario =
	| "im-claw" // Claw IM 对话
	| "conversation" // 普通对话
	| "project" // 普通项目中对话
	| "batch" // 批量任务对话
	| "automation" // 自动化任务对话
	| "kb-processing" // 知识库加工对话
	| "cli"; // 裸 CLI / SDK 消费者
