import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { McpOAuthStateStore } from "./oauth-state-store.js";

const DEFAULT_POLL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_SEC = 5;
const PLACEHOLDER_REDIRECT = "http://127.0.0.1/callback";

const ProtectedResourceMetadataSchema = Type.Object(
	{ authorization_servers: Type.Optional(Type.Array(Type.String())) },
	{ additionalProperties: true },
);

const DeviceCodeResponseSchema = Type.Object(
	{
		device_code: Type.String({ minLength: 1 }),
		user_code: Type.String({ minLength: 1 }),
		verification_uri: Type.String({ minLength: 1 }),
		verification_uri_complete: Type.Optional(Type.String()),
		expires_in: Type.Optional(Type.Number()),
		interval: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const DeviceTokenResponseSchema = Type.Object(
	{
		access_token: Type.Optional(Type.String()),
		token_type: Type.Optional(Type.String()),
		scope: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
		error_description: Type.Optional(Type.String()),
		interval: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

export interface McpDeviceAuthorizationScheduler {
	now(): number;
	wait(milliseconds: number): Promise<void>;
}

export interface McpDeviceCodePresentation {
	readonly url: string;
	close(): Promise<void>;
}

export interface McpDeviceCodeInfo {
	readonly userCode: string;
	readonly verificationUri: string;
	readonly verificationUriComplete?: string;
}

export interface McpDeviceAuthorizationFlowOptions {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly clientId: string;
	readonly scopes?: string;
	readonly pollTimeoutMs?: number;
	readonly fallbackIssuer: string;
	readonly store: McpOAuthStateStore;
	readonly fetchFn?: typeof fetch;
	readonly scheduler?: McpDeviceAuthorizationScheduler;
	readonly onUserCode?: (info: { userCode: string; verificationUri: string }) => void | Promise<void>;
	readonly createPresentation: (info: McpDeviceCodeInfo) => Promise<McpDeviceCodePresentation>;
	readonly openUrl: (url: string) => void | Promise<void>;
}

export interface McpDeviceAuthorizationFlowResult {
	readonly serverName: string;
	readonly serverUrl: string;
}

export class McpDeviceCodeRequestError extends Error {
	constructor(
		readonly status: number,
		readonly bodyPreview: string,
	) {
		super(`Device code request failed (${status}): ${bodyPreview}`);
		this.name = "McpDeviceCodeRequestError";
	}
}

const systemScheduler: McpDeviceAuthorizationScheduler = {
	now: () => Date.now(),
	wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

/** RFC 8628 device authorization use case with injected host interaction and persistence. */
export async function runMcpDeviceAuthorizationFlow(
	options: McpDeviceAuthorizationFlowOptions,
): Promise<McpDeviceAuthorizationFlowResult> {
	const serverUrl = options.serverUrl.trim();
	if (!serverUrl) throw new Error("serverUrl is required");
	const serverName = options.serverName.trim();
	if (!serverName) throw new Error("serverName is required");
	const clientId = options.clientId.trim();
	if (!clientId) throw new Error("oauthClientId is required for the device flow");

	const fetchFn = options.fetchFn ?? fetch;
	const scheduler = options.scheduler ?? systemScheduler;
	const { deviceUrl, tokenUrl } = await discoverEndpoints(serverUrl, options.fallbackIssuer, fetchFn);
	const device = await requestDeviceCode(deviceUrl, clientId, options.scopes, fetchFn);
	const info: McpDeviceCodeInfo = {
		userCode: device.user_code,
		verificationUri: device.verification_uri,
		verificationUriComplete: device.verification_uri_complete,
	};

	await options.onUserCode?.({ userCode: info.userCode, verificationUri: info.verificationUri });
	const presentation = await options.createPresentation(info);
	let token: DeviceTokenSuccess;
	try {
		await options.openUrl(presentation.url);
		const timeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
		const deadline = scheduler.now() + Math.min(timeoutMs, (device.expires_in || 900) * 1000);
		token = await pollForToken(
			tokenUrl,
			clientId,
			device.device_code,
			device.interval ?? DEFAULT_INTERVAL_SEC,
			deadline,
			fetchFn,
			scheduler,
		);
	} finally {
		await presentation.close().catch(() => undefined);
	}

	options.store.save(serverName, {
		serverUrl,
		redirectUri: PLACEHOLDER_REDIRECT,
		clientInformation: { client_id: clientId },
		tokens: {
			access_token: token.access_token,
			token_type: token.token_type || "bearer",
			...(token.scope ? { scope: token.scope } : {}),
		},
	});
	return { serverName, serverUrl };
}

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	expires_in?: number;
	interval?: number;
}

interface DeviceTokenResponse {
	access_token?: string;
	token_type?: string;
	scope?: string;
	error?: string;
	error_description?: string;
}

interface DeviceTokenSuccess extends DeviceTokenResponse {
	access_token: string;
}

async function discoverEndpoints(
	serverUrl: string,
	fallbackIssuer: string,
	fetchFn: typeof fetch,
): Promise<{ deviceUrl: string; tokenUrl: string }> {
	let issuer = fallbackIssuer.replace(/\/$/, "");
	try {
		const url = new URL(serverUrl);
		const path = url.pathname.replace(/\/$/, "");
		const wellKnown = `${url.origin}/.well-known/oauth-protected-resource${path}`;
		const response = await fetchFn(wellKnown, { headers: { Accept: "application/json" } });
		if (response.ok) {
			const metadata: unknown = await response.json();
			if (Value.Check(ProtectedResourceMetadataSchema, metadata)) {
				const first = metadata.authorization_servers?.[0];
				if (typeof first === "string" && first.trim()) issuer = first.trim().replace(/\/$/, "");
			}
		}
	} catch {
		// Preserve fallback behavior for discovery and response failures.
	}
	return { deviceUrl: `${issuer}/device/code`, tokenUrl: `${issuer}/access_token` };
}

async function requestDeviceCode(
	deviceUrl: string,
	clientId: string,
	scopes: string | undefined,
	fetchFn: typeof fetch,
): Promise<DeviceCodeResponse> {
	const body = new URLSearchParams({ client_id: clientId });
	if (scopes?.trim()) body.set("scope", scopes.trim());
	const response = await fetchFn(deviceUrl, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const text = await response.text();
	if (!response.ok) throw new McpDeviceCodeRequestError(response.status, text.slice(0, 200));

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`Device code endpoint returned non-JSON response: ${text.slice(0, 200)}`);
	}
	if (!Value.Check(DeviceCodeResponseSchema, value)) {
		throw new Error(`Device code response missing required fields: ${text.slice(0, 200)}`);
	}
	return value;
}

async function pollForToken(
	tokenUrl: string,
	clientId: string,
	deviceCode: string,
	intervalSec: number,
	deadline: number,
	fetchFn: typeof fetch,
	scheduler: McpDeviceAuthorizationScheduler,
): Promise<DeviceTokenSuccess> {
	let intervalMs = Math.max(intervalSec, 1) * 1000;
	while (scheduler.now() < deadline) {
		await scheduler.wait(intervalMs);
		const body = new URLSearchParams({
			client_id: clientId,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		});
		const response = await fetchFn(tokenUrl, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		const text = await response.text();
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch {
			throw new Error(`Token endpoint returned non-JSON response: ${text.slice(0, 200)}`);
		}
		if (!Value.Check(DeviceTokenResponseSchema, value)) throw new Error("Device authorization failed");
		if (value.access_token) return { ...value, access_token: value.access_token };
		switch (value.error) {
			case "authorization_pending":
				break;
			case "slow_down":
				intervalMs += 5000;
				break;
			case "expired_token":
				throw new Error("Device code expired before authorization. Please try again.");
			case "access_denied":
				throw new Error("Authorization was denied.");
			default:
				throw new Error(value.error_description || value.error || "Device authorization failed");
		}
	}
	throw new Error("Timed out waiting for device authorization.");
}
