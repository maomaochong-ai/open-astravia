// ─── System notifications ───
/** 点击系统通知后主进程下发的路由意图（按 type 分流，见 CONTEXT.md「通知类型」）。 */
export type NotificationNavigatePayload = {
	type: "agent-turn-complete" | "agent-question-pending";
	sessionPath: string;
	cwd: string;
};

export interface DesktopNotificationApi {
	/** 上报聊天页当前所在 session path；离开聊天页传 null。主进程据此 + 窗口聚焦态做抑制判定。 */
	setForegroundSession(sessionPath: string | null): Promise<void>;
	/** 用户点击系统通知时触发，渲染端按 payload.type 路由。返回取消订阅函数。 */
	onNavigate(handler: (payload: NotificationNavigatePayload) => void): () => void;
}
