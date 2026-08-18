export interface McpServerCommonConfigData {
	disabled?: boolean;
	autoApprove?: string[];
	startupTimeout?: number;
	debug?: boolean;
	/** 仅 UI 展示用的可读名（mcp.json 里的 key 仍是真实 name）。 */
	displayName?: string;
	/** 仅 UI 展示用的描述。 */
	description?: string;
	/** 仅 UI 展示用的图标 URL（远程市场/自定义配置）。 */
	icon?: string;
}

export interface McpStdioServerConfigData extends McpServerCommonConfigData {
	type?: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface McpHttpServerConfigData extends McpServerCommonConfigData {
	type: "http";
	url: string;
	headers?: Record<string, string>;
	/**
	 * 预注册 OAuth client_id：用于不支持 DCR 的远程 MCP（如 GitHub）。
	 * 公开客户端 + PKCE，无 client_secret；非密钥，可安全写入 mcp.json。
	 */
	oauthClientId?: string;
	/** 使用设备码流（Device Flow）而非授权码流：GitHub 等要求 secret 的服务用它免密授权。 */
	oauthDeviceFlow?: boolean;
	/** 设备码流请求的 OAuth scopes（空格分隔）。 */
	oauthScopes?: string;
}

export type McpServerConfigData = McpStdioServerConfigData | McpHttpServerConfigData;

export interface McpConfigData {
	mcpServers: Record<string, McpServerConfigData>;
}

export interface DesktopMcpApi {
	get(): Promise<McpConfigData>;
	set(config: McpConfigData): Promise<void>;
	/**
	 * 对 type:http 的远程 MCP 发起浏览器 OAuth 授权（通用机制，不限 Notion）。
	 * 成功后 token 写入 ~/.vetta/agent/mcp-auth/<name>.json。
	 * `url` 可选：首次添加时尚未写入 mcp.json，可直接传远程 MCP 地址。
	 * `oauthClientId` 可选：不支持 DCR 的服务（如 GitHub）首次授权时透传预注册 client_id。
	 * `oauthDeviceFlow`/`oauthScopes` 可选：首次授权时透传设备码流开关与请求 scopes。
	 */
	login(
		serverName: string,
		options?: { url?: string; oauthClientId?: string; oauthDeviceFlow?: boolean; oauthScopes?: string },
	): Promise<void>;
	/** 清除该 server 的 OAuth 凭证 */
	logout(serverName: string): Promise<void>;
	/** 是否已有该 server 的 OAuth token（不探测连通性） */
	hasAuth(serverName: string): Promise<boolean>;
	/** 批量查询多个 server 的授权状态 */
	authStatus(serverNames: string[]): Promise<Record<string, boolean>>;
}
