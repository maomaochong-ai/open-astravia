import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpOAuthStoredState } from "./oauth-state.js";
import type { McpOAuthStateStore } from "./oauth-state-store.js";

export interface McpOAuthProviderOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly redirectUri: string;
	readonly onRedirect: (authorizationUrl: URL) => void | Promise<void>;
	readonly store: McpOAuthStateStore;
	readonly clientName: string;
	readonly clientId?: string;
}

/** SDK OAuth provider backed only by the injected state store. */
export class McpOAuthProvider implements OAuthClientProvider {
	private readonly serverName: string;
	private readonly serverUrl: string;
	private readonly redirectUriOption: string;
	private readonly onRedirect: (authorizationUrl: URL) => void | Promise<void>;
	private readonly store: McpOAuthStateStore;
	private readonly clientName: string;
	private readonly clientId?: string;
	private stored: McpOAuthStoredState;

	constructor(options: McpOAuthProviderOptions) {
		this.serverName = options.serverName;
		this.serverUrl = options.serverUrl;
		this.redirectUriOption = options.redirectUri;
		this.onRedirect = options.onRedirect;
		this.store = options.store;
		this.clientName = options.clientName;
		this.clientId = options.clientId?.trim() || undefined;

		const existing = this.store.load(this.serverName);
		if (!existing || existing.serverUrl !== this.serverUrl) {
			this.stored = { serverUrl: this.serverUrl, redirectUri: this.redirectUriOption };
			this.seedPreRegisteredClient();
			if (existing || this.stored.clientInformation) this.persist();
		} else {
			this.stored = { ...existing, serverUrl: this.serverUrl };
			const interactiveRedirectChange =
				!isPlaceholderRedirect(this.redirectUriOption) &&
				Boolean(existing.redirectUri) &&
				existing.redirectUri !== this.redirectUriOption;
			if (interactiveRedirectChange) {
				this.stored.clientInformation = undefined;
				this.stored.redirectUri = this.redirectUriOption;
				this.stored.discoveryState = undefined;
				this.seedPreRegisteredClient();
				this.persist();
			} else {
				if (!this.stored.redirectUri) this.stored.redirectUri = this.redirectUriOption;
				if (this.clientId && !this.stored.clientInformation) {
					this.seedPreRegisteredClient();
					this.persist();
				}
			}
		}
	}

	get redirectUrl(): string {
		return this.stored.redirectUri || this.redirectUriOption;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: this.clientName,
			redirect_uris: [this.redirectUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		};
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.stored.clientInformation;
	}

	async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
		this.stored.clientInformation = clientInformation;
		this.persist();
	}

	tokens(): OAuthTokens | undefined {
		return this.stored.tokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		const previous = this.stored.tokens;
		this.stored.tokens = {
			...tokens,
			refresh_token: tokens.refresh_token ?? previous?.refresh_token,
		};
		this.stored.codeVerifier = undefined;
		this.persist();
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		await this.onRedirect(authorizationUrl);
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		this.stored.codeVerifier = codeVerifier;
		this.persist();
	}

	async codeVerifier(): Promise<string> {
		if (!this.stored.codeVerifier) {
			throw new Error(`No PKCE code verifier stored for MCP server '${this.serverName}'`);
		}
		return this.stored.codeVerifier;
	}

	async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
		if (scope === "all") {
			this.store.clear(this.serverName);
			this.stored = { serverUrl: this.serverUrl, redirectUri: this.redirectUriOption };
			return;
		}
		if (scope === "client") {
			this.stored.clientInformation = undefined;
		} else if (scope === "tokens") {
			this.stored.tokens = undefined;
		} else if (scope === "verifier") {
			this.stored.codeVerifier = undefined;
		} else if (scope === "discovery") {
			this.stored.discoveryState = undefined;
		}
		this.persist();
	}

	async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
		this.stored.discoveryState = discovery;
		this.persist();
	}

	discoveryState(): OAuthDiscoveryState | undefined {
		return this.stored.discoveryState;
	}

	private seedPreRegisteredClient(): void {
		if (this.clientId) this.stored.clientInformation = { client_id: this.clientId };
	}

	private persist(): void {
		this.store.save(this.serverName, this.stored);
	}
}

function isPlaceholderRedirect(redirectUri: string): boolean {
	return (
		redirectUri.includes("127.0.0.1:0") ||
		redirectUri === "http://127.0.0.1/callback" ||
		redirectUri === "http://localhost/callback"
	);
}
