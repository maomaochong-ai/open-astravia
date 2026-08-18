/**
 * refresh 的三态结果。区分明确拒绝与暂时性失败，避免网络波动时误登出。
 */
export type RefreshOutcome =
	| { status: "ok"; accessToken: string }
	| { status: "unauthorized" }
	| { status: "transient" };

export interface DesktopAuthApi {
	openExternal(url: string): Promise<void>;
	/**
	 * 发起授权登录：主进程生成一次性 state、拼授权地址并唤起系统浏览器。
	 * URL 拼接与 state 校验都留在主进程——渲染层不持有 state，也就无从绕过校验。
	 */
	startOAuth(): Promise<void>;
	/** 重新打开当前这次授权的链接（复用同一 state），用于浏览器没起来时的补救。 */
	reopenOAuth(): Promise<void>;
	/**
	 * 委托主进程用磁盘上的 refresh_token 换新 access。
	 * 渲染层不要再直接调 /auth/refresh —— 跨进程同时用同一 refresh_token 会被服务端
	 * 视作 reuse 并 revoke，造成"老是掉登录"的体感问题。
	 */
	refreshToken(): Promise<RefreshOutcome>;
	onOAuthCallback(handler: (data: { token: string; refreshToken?: string }) => void): () => void;
	/**
	 * 回调的 state 校验未通过（过期链接、旧标签页、客户端重启后 state 已丢失）。
	 * 主进程已丢弃其中的 token，故本事件不带任何 payload。
	 */
	onOAuthRejected(handler: () => void): () => void;
	/**
	 * 主进程发起的请求（如 fetchRemoteProviders / credits balance）收到 401 时触发。
	 * 渲染层应在这里执行登出，但不要中断正在运行的本地模型会话。
	 */
	onUnauthorized(handler: () => void): () => void;
	/** 主进程通过 refresh token 拿到新 access+refresh 后广播给渲染层。 */
	onTokenRefreshed(handler: (data: { accessToken: string; refreshToken: string }) => void): () => void;
}
