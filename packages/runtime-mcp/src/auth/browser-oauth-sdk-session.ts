import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpClientInfo } from "../protocol/index.js";
import type { McpBrowserOAuthSession } from "./browser-oauth-flow.js";

export interface McpBrowserOAuthSdkSessionOptions {
	readonly url: URL;
	readonly authProvider: OAuthClientProvider;
	readonly clientInfo: McpClientInfo;
	readonly timeout: number;
	readonly fetchFn?: typeof fetch;
}

export function createMcpBrowserOAuthSdkSession(options: McpBrowserOAuthSdkSessionOptions): McpBrowserOAuthSession {
	return new DefaultMcpBrowserOAuthSdkSession(options);
}

/** Preserve actionable OAuth errors from providers returning HTTP 200 error bodies. */
export function createMcpOAuthDiagnosticFetch(fetchFn: typeof fetch = fetch): typeof fetch {
	return async (input, init) => {
		const response = await fetchFn(input, init);
		const method = (init?.method ?? "GET").toUpperCase();
		if (method !== "POST" || !response.ok) return response;
		let body: string;
		try {
			body = await response.clone().text();
		} catch {
			return response;
		}
		if (/access_token/.test(body) || !/error/i.test(body)) return response;
		const message = extractOAuthError(body);
		if (message) throw new Error(`OAuth authorization failed: ${message}`);
		return response;
	};
}

class DefaultMcpBrowserOAuthSdkSession implements McpBrowserOAuthSession {
	private readonly transport: StreamableHTTPClientTransport;
	private readonly client: Client;

	constructor(private readonly options: McpBrowserOAuthSdkSessionOptions) {
		this.transport = this.createTransport();
		this.client = this.createClient();
	}

	async connect(): Promise<"authorized" | "authorization_required"> {
		try {
			await this.client.connect(this.transport, { timeout: this.options.timeout });
			await this.client.close().catch(() => undefined);
			return "authorized";
		} catch (error) {
			if (error instanceof UnauthorizedError) return "authorization_required";
			throw error;
		}
	}

	async finishAuthorization(code: string): Promise<void> {
		await this.transport.finishAuth(code);
	}

	async verify(): Promise<void> {
		const transport = this.createTransport();
		const client = this.createClient();
		await client.connect(transport, { timeout: this.options.timeout });
		await client.close().catch(() => undefined);
	}

	private createTransport(): StreamableHTTPClientTransport {
		return new StreamableHTTPClientTransport(this.options.url, {
			authProvider: this.options.authProvider,
			fetch: createMcpOAuthDiagnosticFetch(this.options.fetchFn),
		});
	}

	private createClient(): Client {
		return new Client(this.options.clientInfo, { capabilities: {} });
	}
}

function extractOAuthError(body: string): string | null {
	try {
		const json = JSON.parse(body) as { error?: unknown; error_description?: unknown };
		if (json && typeof json === "object" && typeof json.error === "string") {
			return typeof json.error_description === "string" ? `${json.error}: ${json.error_description}` : json.error;
		}
	} catch {
		const params = new URLSearchParams(body);
		const error = params.get("error");
		if (error) {
			const description = params.get("error_description");
			return description ? `${error}: ${description}` : error;
		}
	}
	return null;
}
