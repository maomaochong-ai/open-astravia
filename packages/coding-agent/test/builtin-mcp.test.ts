import { describe, expect, it } from "vitest";
import {
	buildBuiltinMcpServers,
	VETTA_BUILTIN_MCP_NAME,
	VETTA_CLIENT_VERSION_HEADER,
} from "../src/core/mcp/builtin-mcp.js";
import type { VettaCredentials } from "../src/core/mcp/vetta-credentials.js";

const CREDENTIALS: VettaCredentials = { baseUrl: "https://api.example.com", token: "tok-1" };

function build(credentials: VettaCredentials | null, clientVersion = "1.2.3") {
	return buildBuiltinMcpServers({ clientVersion, loadCredentials: () => credentials });
}

describe("buildBuiltinMcpServers", () => {
	it("组装指向服务端 MCP endpoint 的 http 配置", () => {
		const config = build(CREDENTIALS)[VETTA_BUILTIN_MCP_NAME];

		expect(config).toBeDefined();
		expect(config.type).toBe("http");
		expect(config.url).toBe("https://api.example.com/api/v1/mcp");
	});

	it("baseUrl 自带 API 前缀时不重复拼接", () => {
		// 桌面端注入的 VETTA_SERVER_URL 本身就带 /api/v1，手工配的通常只到域名，
		// 不归一就会拼出 /api/v1/api/v1/mcp 而 404
		const config = build({ baseUrl: "https://api.example.com/api/v1", token: "t" })[VETTA_BUILTIN_MCP_NAME];

		expect(config.url).toBe("https://api.example.com/api/v1/mcp");
	});

	it("未登录时不注册内置服务", () => {
		// 注册一个必然 401 的 server 只会让每次会话启动都白连一次、等一次超时
		expect(build(null)).toEqual({});
	});

	it("带客户端版本头", () => {
		// 服务端靠它决定下发哪些工具；漏发这一版，闸门对老客户端就永久失效
		const config = build(CREDENTIALS, "0.6.0")[VETTA_BUILTIN_MCP_NAME];

		expect(config.headers?.[VETTA_CLIENT_VERSION_HEADER]).toBe("0.6.0");
	});

	it("启动超时明显短于通用 MCP 默认值", () => {
		// 内置服务不可用只该少一组工具，不该让每次新会话先干等 30s
		const config = build(CREDENTIALS)[VETTA_BUILTIN_MCP_NAME];

		expect(config.startupTimeout).toBeLessThanOrEqual(5000);
	});

	it("运行时名不含下划线", () => {
		// 工具适配器按 mcp_${server}_${tool} 命名并按第一个 _ 切分，
		// server 名里出现下划线会把工具名切错
		expect(VETTA_BUILTIN_MCP_NAME).not.toContain("_");
	});

	it("token 不写进静态 headers", () => {
		// 静态 header 在建立连接时定死，token 轮换后会持续 401 到客户端重启
		const config = build(CREDENTIALS)[VETTA_BUILTIN_MCP_NAME];

		expect(JSON.stringify(config.headers ?? {})).not.toContain("tok-1");
	});

	it("每次解析 header 都重读凭据，拿到轮换后的 token", () => {
		let current: VettaCredentials | null = { baseUrl: "https://api.example.com", token: "old" };
		const servers = buildBuiltinMcpServers({ loadCredentials: () => current });
		const resolve = servers[VETTA_BUILTIN_MCP_NAME].resolveHeaders;

		expect(resolve?.()).toEqual({ Authorization: "Bearer old" });

		current = { baseUrl: "https://api.example.com", token: "new" };
		expect(resolve?.()).toEqual({ Authorization: "Bearer new" });
	});

	it("登出后不再带 Authorization", () => {
		// 带一个空 Bearer 造成的错误比干脆的 401 难定位得多
		let current: VettaCredentials | null = CREDENTIALS;
		const servers = buildBuiltinMcpServers({ loadCredentials: () => current });
		const resolve = servers[VETTA_BUILTIN_MCP_NAME].resolveHeaders;

		current = null;
		expect(resolve?.()).toEqual({});
	});
});
