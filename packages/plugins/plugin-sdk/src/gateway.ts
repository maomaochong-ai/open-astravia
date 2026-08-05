/**
 * Vetta 服务端网关调用（ADR-0056）。
 *
 * 与 `ctx.network.request` 的关键区别：插件只给出 **相对 `/api/v1` 的路径**，
 * 服务端地址与登录凭据由宿主主进程解析注入，401 也由宿主刷新后重试。插件拿不到
 * token，也拼不出指向其它接口的 URL——把 JWT 交给插件进程等于开放全部 `/api/v1`
 * 的越权面，因此 SDK 不提供「取 token 自己拼」的口子。
 *
 * 只有随包分发的内置（official）插件能拿到 `ctx.gateway`，第三方插件读到
 * `undefined`。风险性质不是越权（服务端档位授权限定了可用模型，消耗的是用户自己
 * 的额度），而是插件偷跑烧光用户配额；在缺少插件签名与审核机制前先按来源收口。
 */

export interface PluginGatewayRequest {
	/** 相对 `/api/v1` 的路径，如 `images/generate`。不接受绝对 URL。 */
	path: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	/** JSON 请求体；宿主负责序列化并设置 content-type。 */
	body?: unknown;
	timeoutMs?: number;
}

/**
 * 业务信封已由宿主拆开：`ok` 为 true 时 `data` 有值，否则看 `code` / `message`。
 * 不抛异常——配额用尽、档位无权限这类结果是常规业务分支，插件要据此渲染引导而非报错。
 */
export interface PluginGatewayResponse<T = unknown> {
	ok: boolean;
	/** HTTP 状态码；网络层失败为 0。 */
	status: number;
	/** 业务错误码（服务端 errcode），成功为 0。 */
	code: number;
	message: string;
	data?: T;
}

export interface PluginGatewayApi {
	request<T = unknown>(request: PluginGatewayRequest): Promise<PluginGatewayResponse<T>>;
}
