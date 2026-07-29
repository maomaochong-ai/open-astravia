/**
 * 宿主自带的内置 MCP server。
 *
 * 与「用户装的 MCP」的区别是意图而非机制：内置服务是产品的一部分，用户既不需要
 * 配置它，也不该在能力市场里看到它——所以它不写 mcp.json、不作为可安装条目出现，
 * 只在运行时注入（见 McpManager 的 builtinServers）。
 *
 * 它是**远程**服务：工具清单由服务端按调用者身份与客户端版本动态下发，客户端
 * 不知道有哪些工具，服务端加一个增值服务也不需要客户端发版。这是它存在的全部
 * 意义，故这里刻意只连一个 endpoint——按服务拆多个 endpoint 会把「有哪些服务」
 * 重新变成客户端必须知道的知识。
 *
 * 需要读用户本地文件的动作（例如把本地能力包传上市场）不在这条通道里：远程服务
 * 摸不到用户磁盘。那类动作走 skill 内置脚本，见 skill-presets/publish-ability。
 */

import type { McpHttpServerConfig } from "./types.js";
import { loadVettaCredentials, vettaApiUrl } from "./vetta-credentials.js";

/**
 * 内置 vetta server 的运行时名。
 * 不能含下划线——工具适配器按 `mcp_${serverName}_${toolName}` 命名并按第一个 `_` 切分。
 */
export const VETTA_BUILTIN_MCP_NAME = "vetta";

/** 服务端 MCP endpoint 的路径（挂在 API 前缀下）。 */
export const VETTA_BUILTIN_MCP_PATH = "/mcp";

/**
 * 客户端版本头。服务端据此决定下发哪些工具。
 *
 * 必须**每一版都带**：老客户端不会补发这个头，服务端只能把没带头的一律当成最老
 * 版本，「新工具只对新客户端可见」这条闸门一旦漏发就永久失效。
 */
export const VETTA_CLIENT_VERSION_HEADER = "X-Vetta-Client-Version";

/**
 * 内置服务的连接超时。
 *
 * 明显短于通用 MCP 的 30s 默认值：内置服务不可用时只该少一组增值工具，不该让
 * 每次新会话都先干等半分钟。服务端挂了、断网、被墙都走这条路径。
 */
const BUILTIN_STARTUP_TIMEOUT_MS = 3000;

export interface BuildBuiltinMcpOptions {
	/** 客户端版本，写进版本头。省略时服务端按最老客户端对待。 */
	clientVersion?: string;
	/** 覆盖凭据读取，测试用。 */
	loadCredentials?: typeof loadVettaCredentials;
}

/**
 * 组装内置 server 集合。返回空对象表示这次没有可用的内置服务。
 *
 * 未登录时**不注册**：内置 MCP 是登录用户的增值服务，未登录时注册一个必然 401
 * 的 server，只会让每次会话启动都白白连一次、等一次超时。用户登录后新开会话即可
 * 拿到，无需重启。
 */
export function buildBuiltinMcpServers(options: BuildBuiltinMcpOptions = {}): Record<string, McpHttpServerConfig> {
	const load = options.loadCredentials ?? loadVettaCredentials;
	const credentials = load();
	if (!credentials) return {};

	const headers: Record<string, string> = {};
	if (options.clientVersion) {
		headers[VETTA_CLIENT_VERSION_HEADER] = options.clientVersion;
	}

	return {
		[VETTA_BUILTIN_MCP_NAME]: {
			type: "http",
			url: vettaApiUrl(credentials.baseUrl, VETTA_BUILTIN_MCP_PATH),
			headers,
			startupTimeout: BUILTIN_STARTUP_TIMEOUT_MS,
			// 凭据按请求解析而不是写进 headers：access token 会轮换，写死在连接上
			// 就会在轮换后持续 401 直到整个客户端重启。
			resolveHeaders: (): Record<string, string> => {
				const fresh = load();
				// 读不到凭据（登出、文件被删）就不带 Authorization：让服务端以 401
				// 明确拒绝，比带一个空 Bearer 造成的诡异错误好定位。
				return fresh ? { Authorization: `Bearer ${fresh.token}` } : {};
			},
		},
	};
}
