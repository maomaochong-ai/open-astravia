import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	createMcpBrowserOAuthSdkSession,
	FileMcpOAuthStateStore,
	McpDeviceCodeRequestError,
	McpOAuthProvider,
	runMcpBrowserOAuthFlow,
	runMcpDeviceAuthorizationFlow,
} from "@vetta/runtime-mcp";
import { mainT } from "../i18n/index.js";
import { openExternalUrl } from "../open-external.js";
import { createDeviceCodePresentation, createOAuthCallbackSession } from "./mcp-oauth-host-ui.js";

const CLIENT_NAME = "Vetta";
const CLIENT_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 60_000;
const AUTH_WAIT_TIMEOUT_MS = 5 * 60_000;
const DEVICE_FLOW_FALLBACK_ISSUER = "https://github.com/login/oauth";

export interface DesktopMcpBrowserLoginOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly oauthClientId?: string;
}

export interface DesktopMcpDeviceLoginOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly clientId: string;
	readonly scopes?: string;
}

export interface DesktopMcpOAuthServiceOptions {
	readonly authDirectory: string;
	readonly openUrl: (url: string) => void | Promise<void>;
	readonly browserFlow?: typeof runMcpBrowserOAuthFlow;
	readonly deviceFlow?: typeof runMcpDeviceAuthorizationFlow;
}

/** Desktop-owned interactive OAuth UX around the transport-neutral runtime flows. */
export class DesktopMcpOAuthService {
	private readonly store: FileMcpOAuthStateStore;
	private readonly browserFlow: typeof runMcpBrowserOAuthFlow;
	private readonly deviceFlow: typeof runMcpDeviceAuthorizationFlow;

	constructor(private readonly options: DesktopMcpOAuthServiceOptions) {
		this.store = new FileMcpOAuthStateStore({ authDirectory: options.authDirectory });
		this.browserFlow = options.browserFlow ?? runMcpBrowserOAuthFlow;
		this.deviceFlow = options.deviceFlow ?? runMcpDeviceAuthorizationFlow;
	}

	async loginBrowser(options: DesktopMcpBrowserLoginOptions): Promise<void> {
		await this.browserFlow({
			serverName: options.serverName,
			serverUrl: options.serverUrl,
			authTimeoutMs: AUTH_WAIT_TIMEOUT_MS,
			createCallbackSession: createOAuthCallbackSession,
			openUrl: this.options.openUrl,
			createOAuthSession: ({ redirectUri, onRedirect }) => {
				const serverName = options.serverName.trim();
				const serverUrl = options.serverUrl.trim();
				const provider = new McpOAuthProvider({
					serverName,
					serverUrl,
					redirectUri,
					onRedirect,
					store: this.store,
					clientName: CLIENT_NAME,
					clientId: options.oauthClientId,
				});
				return createMcpBrowserOAuthSdkSession({
					url: new URL(serverUrl),
					authProvider: provider,
					clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
					timeout: DEFAULT_TIMEOUT_MS,
				});
			},
		});
	}

	async loginDevice(options: DesktopMcpDeviceLoginOptions): Promise<void> {
		try {
			await this.deviceFlow({
				serverName: options.serverName,
				serverUrl: options.serverUrl,
				clientId: options.clientId,
				scopes: options.scopes,
				fallbackIssuer: DEVICE_FLOW_FALLBACK_ISSUER,
				store: this.store,
				createPresentation: createDeviceCodePresentation,
				openUrl: this.options.openUrl,
			});
		} catch (error) {
			if (error instanceof McpDeviceCodeRequestError && error.status === 422) {
				throw new Error(mainT("mcpOAuth.deviceFlowDisabled", { details: error.bodyPreview }));
			}
			throw error;
		}
	}

	logout(serverName: string): void {
		this.store.clear(serverName);
	}

	hasAuth(serverName: string): boolean {
		return this.store.hasTokens(serverName);
	}
}

let desktopMcpOAuthService: DesktopMcpOAuthService | undefined;

export function getDesktopMcpOAuthService(): DesktopMcpOAuthService {
	desktopMcpOAuthService ??= new DesktopMcpOAuthService({
		authDirectory: join(getVettaHomePath(), "agent", "mcp-auth"),
		openUrl: openExternalUrl,
	});
	return desktopMcpOAuthService;
}
