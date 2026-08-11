import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export interface McpOAuthStoredState {
	/** Server endpoint URL this credential set belongs to. */
	serverUrl: string;
	clientInformation?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	codeVerifier?: string;
	discoveryState?: OAuthDiscoveryState;
	/** Redirect URI used when the client was registered. */
	redirectUri?: string;
	updatedAt?: string;
}

const OAuthClientInformationSchema = Type.Object(
	{
		client_id: Type.String(),
		client_secret: Type.Optional(Type.String()),
		client_id_issued_at: Type.Optional(Type.Number()),
		client_secret_expires_at: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

// Keep access_token and token_type optional for compatibility with historical
// refresh-token-only files. The SDK still receives the original stored shape.
const OAuthTokensSchema = Type.Object(
	{
		access_token: Type.Optional(Type.String()),
		id_token: Type.Optional(Type.String()),
		token_type: Type.Optional(Type.String()),
		expires_in: Type.Optional(Type.Number()),
		scope: Type.Optional(Type.String()),
		refresh_token: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

const OAuthDiscoveryStateSchema = Type.Object(
	{
		authorizationServerUrl: Type.String(),
		authorizationServerMetadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
		resourceMetadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
		resourceMetadataUrl: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const McpOAuthStoredStateSchema = Type.Object(
	{
		serverUrl: Type.String(),
		clientInformation: Type.Optional(OAuthClientInformationSchema),
		tokens: Type.Optional(OAuthTokensSchema),
		codeVerifier: Type.Optional(Type.String()),
		discoveryState: Type.Optional(OAuthDiscoveryStateSchema),
		redirectUri: Type.Optional(Type.String()),
		updatedAt: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

/** Validate untrusted persisted JSON without changing the tolerant load contract. */
export function parseMcpOAuthStoredState(value: unknown): McpOAuthStoredState | undefined {
	if (!Value.Check(McpOAuthStoredStateSchema, value)) return undefined;
	return value as McpOAuthStoredState;
}
