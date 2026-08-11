export interface McpOAuthCallbackSession {
	readonly redirectUri: string;
	waitForCode(timeoutMs: number): Promise<string>;
	close(): Promise<void>;
}

export interface McpBrowserOAuthSession {
	connect(): Promise<"authorized" | "authorization_required">;
	finishAuthorization(code: string): Promise<void>;
	verify(): Promise<void>;
}

export interface McpBrowserOAuthSessionContext {
	readonly redirectUri: string;
	readonly onRedirect: (authorizationUrl: URL) => Promise<void>;
}

export interface McpBrowserOAuthFlowOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly authTimeoutMs: number;
	readonly createCallbackSession: () => Promise<McpOAuthCallbackSession>;
	readonly createOAuthSession: (context: McpBrowserOAuthSessionContext) => McpBrowserOAuthSession;
	readonly openUrl: (url: string) => void | Promise<void>;
}

export interface McpBrowserOAuthFlowResult {
	readonly serverName: string;
	readonly serverUrl: string;
}

/** Browser authorization-code use case independent of OS and callback-server implementations. */
export async function runMcpBrowserOAuthFlow(options: McpBrowserOAuthFlowOptions): Promise<McpBrowserOAuthFlowResult> {
	const serverUrl = options.serverUrl.trim();
	if (!serverUrl) throw new Error("serverUrl is required");
	const serverName = options.serverName.trim();
	if (!serverName) throw new Error("serverName is required");

	const callback = await options.createCallbackSession();
	try {
		const session = options.createOAuthSession({
			redirectUri: callback.redirectUri,
			onRedirect: async (authorizationUrl) => {
				await options.openUrl(authorizationUrl.toString());
			},
		});
		const status = await session.connect();
		if (status === "authorized") return { serverName, serverUrl };

		const code = await callback.waitForCode(options.authTimeoutMs);
		await session.finishAuthorization(code);
		await session.verify();
		return { serverName, serverUrl };
	} finally {
		await callback.close().catch(() => undefined);
	}
}
