import type { ChatMessage } from "../../../shared/store/chat-atoms";

/**
 * 扫描会话消息（从末尾向前），返回最近一条携带数据库表目标（databaseTable）的
 * 用户消息所归属的连接名，作为该会话的「数据库锚点连接」。
 *
 * P1 用途：SQL 代码块动作（在新查询打开 / 执行）需要路由到具体连接。消息块
 * 渲染层没有「所属消息」信息，因此用会话级最近锚点近似——问数类会话由顶栏
 * /表格分析发起时，其 user 消息会携带 databaseTable，后续 AI 回复里的 SQL 块
 * 动作即以此为连接目标。
 *
 * @returns 锚点连接名；会话内无任何数据库锚点时返回 undefined。
 */
export function resolveSessionAnchorConnection(messages: readonly ChatMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.role === "user" && message.databaseTable?.connection) {
			return message.databaseTable.connection;
		}
	}
	return undefined;
}
