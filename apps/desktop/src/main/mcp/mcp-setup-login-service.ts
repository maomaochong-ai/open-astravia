import type {
	McpServerConfigData,
	McpSetupLoginStartResult,
	McpSetupLoginStatus,
} from "../../preload/api-types/mcp.js";
import type { ManagedHttpRuntimeSetup } from "../abilities/open-marketplace/open-marketplace-managed-http-runtime.js";
import {
	ensureOpenMarketplaceManagedMcpRuntime,
	readOpenMarketplaceManagedMcpRuntimeSpec,
	recordOpenMarketplaceMcpSetupStatus,
} from "../abilities/open-marketplace/open-marketplace-mcp-runtime-host.js";
import { readMcpConfig } from "./mcp-settings-service.js";

const REQUEST_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_QR_TIMEOUT_SECONDS = 240;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SETUP_LOGIN_CANCELLED_ERROR = new DOMException("MCP setup login request cancelled", "McpSetupLoginCancelled");

interface SetupTarget {
	readonly runtimeId: string;
	readonly baseUrl: string;
	readonly setup: ManagedHttpRuntimeSetup;
}

interface UpstreamEnvelope {
	readonly success: boolean;
	readonly data: Record<string, unknown>;
	readonly message?: string;
}

export interface McpSetupLoginServiceOptions {
	readonly loadServerConfig?: (serverName: string) => Promise<McpServerConfigData | undefined>;
	readonly ensureRuntime?: (runtimeId: string, environment?: Readonly<Record<string, string>>) => Promise<string>;
	readonly readRuntimeSpec?: typeof readOpenMarketplaceManagedMcpRuntimeSpec;
	readonly recordStatus?: (runtimeId: string, authenticated: boolean) => void;
	readonly fetchImpl?: typeof fetch;
}

interface ActiveQrRequest {
	readonly controller: AbortController;
	cancelled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEnvelope(value: unknown): UpstreamEnvelope {
	if (!isRecord(value) || typeof value.success !== "boolean" || !isRecord(value.data)) {
		throw new Error("MCP login endpoint returned an invalid response");
	}
	if (!value.success) {
		throw new Error(typeof value.message === "string" && value.message ? value.message : "MCP login request failed");
	}
	return {
		success: true,
		data: value.data,
		...(typeof value.message === "string" ? { message: value.message } : {}),
	};
}

function parseStatus(data: Record<string, unknown>): McpSetupLoginStatus {
	if (typeof data.is_logged_in !== "boolean") throw new Error("MCP login status is missing is_logged_in");
	return {
		state: data.is_logged_in ? "authenticated" : "unauthenticated",
		...(typeof data.username === "string" && data.username ? { username: data.username } : {}),
		...(typeof data.user_id === "string" && data.user_id ? { userId: data.user_id } : {}),
	};
}

function parseDurationSeconds(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.ceil(value);
	if (typeof value !== "string") return DEFAULT_QR_TIMEOUT_SECONDS;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(trimmed);
	if (!match) return DEFAULT_QR_TIMEOUT_SECONDS;
	const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
	return seconds > 0 ? Math.ceil(seconds) : DEFAULT_QR_TIMEOUT_SECONDS;
}

function readQrImage(value: unknown): string {
	if (typeof value !== "string" || !value.startsWith("data:image/")) {
		throw new Error("MCP login endpoint did not return a QR code image");
	}
	if (value.length > MAX_IMAGE_BYTES * 1.5) throw new Error("MCP login QR code image is too large");
	return value;
}

/** Uses the upstream service's HTTP auth contract as the only login source of truth. */
export class McpSetupLoginService {
	private readonly loadServerConfig: (serverName: string) => Promise<McpServerConfigData | undefined>;
	private readonly ensureRuntime: (
		runtimeId: string,
		environment?: Readonly<Record<string, string>>,
	) => Promise<string>;
	private readonly readRuntimeSpec: typeof readOpenMarketplaceManagedMcpRuntimeSpec;
	private readonly recordStatus: (runtimeId: string, authenticated: boolean) => void;
	private readonly fetchImpl: typeof fetch;
	private readonly activeQrRequests = new Map<string, ActiveQrRequest>();
	private readonly activeStatusRequests = new Set<AbortController>();

	constructor(options: McpSetupLoginServiceOptions = {}) {
		this.loadServerConfig =
			options.loadServerConfig ?? (async (serverName) => (await readMcpConfig()).mcpServers[serverName]);
		this.ensureRuntime = options.ensureRuntime ?? ensureOpenMarketplaceManagedMcpRuntime;
		this.readRuntimeSpec = options.readRuntimeSpec ?? readOpenMarketplaceManagedMcpRuntimeSpec;
		this.recordStatus = options.recordStatus ?? recordOpenMarketplaceMcpSetupStatus;
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async getStatus(serverName: string): Promise<McpSetupLoginStatus> {
		const controller = new AbortController();
		this.activeStatusRequests.add(controller);
		try {
			const target = await this.resolveTarget(serverName);
			controller.signal.throwIfAborted();
			const envelope = await this.request(target, target.setup.statusPath, "GET", controller);
			const status = parseStatus(envelope.data);
			this.recordStatus(target.runtimeId, status.state === "authenticated");
			return status;
		} finally {
			this.activeStatusRequests.delete(controller);
		}
	}

	async start(serverName: string, requestId: string): Promise<McpSetupLoginStartResult> {
		const previous = this.activeQrRequests.get(requestId);
		if (previous) {
			previous.cancelled = true;
			previous.controller.abort(SETUP_LOGIN_CANCELLED_ERROR);
		}
		const request: ActiveQrRequest = { controller: new AbortController(), cancelled: false };
		this.activeQrRequests.set(requestId, request);
		try {
			const target = await this.resolveTarget(serverName);
			request.controller.signal.throwIfAborted();
			const envelope = await this.request(target, target.setup.qrcodePath, "GET", request.controller);
			const status = parseStatus(envelope.data);
			this.recordStatus(target.runtimeId, status.state === "authenticated");
			if (status.state === "authenticated") {
				return {
					state: "authenticated",
					...(status.username ? { username: status.username } : {}),
					...(status.userId ? { userId: status.userId } : {}),
				};
			}
			return {
				state: "qr_code",
				image: readQrImage(envelope.data.img),
				expiresInSeconds: parseDurationSeconds(envelope.data.timeout),
			};
		} catch (error) {
			if (request.cancelled) return { state: "cancelled" };
			throw error;
		} finally {
			if (this.activeQrRequests.get(requestId) === request) this.activeQrRequests.delete(requestId);
		}
	}

	async clear(serverName: string): Promise<McpSetupLoginStatus> {
		const controller = new AbortController();
		this.activeStatusRequests.add(controller);
		try {
			const target = await this.resolveTarget(serverName);
			controller.signal.throwIfAborted();
			await this.request(target, target.setup.logoutPath, "DELETE", controller);
			const envelope = await this.request(target, target.setup.statusPath, "GET", controller);
			const status = parseStatus(envelope.data);
			this.recordStatus(target.runtimeId, status.state === "authenticated");
			return status;
		} finally {
			this.activeStatusRequests.delete(controller);
		}
	}

	async cancel(requestId: string): Promise<void> {
		const request = this.activeQrRequests.get(requestId);
		if (!request) return;
		this.activeQrRequests.delete(requestId);
		request.cancelled = true;
		request.controller.abort(SETUP_LOGIN_CANCELLED_ERROR);
	}

	async cancelAll(): Promise<void> {
		for (const request of this.activeQrRequests.values()) {
			request.cancelled = true;
			request.controller.abort(SETUP_LOGIN_CANCELLED_ERROR);
		}
		this.activeQrRequests.clear();
		for (const controller of this.activeStatusRequests) controller.abort();
		this.activeStatusRequests.clear();
	}

	private async resolveTarget(serverName: string): Promise<SetupTarget> {
		const config = await this.loadServerConfig(serverName);
		if (!config) throw new Error(`MCP server is not configured: ${serverName}`);
		if (config.type !== "http" || !config.managedRuntimeId) {
			throw new Error("QR-code login requires a managed HTTP MCP server");
		}
		const spec = await this.readRuntimeSpec(config.managedRuntimeId);
		if (!spec.setup) throw new Error("Managed MCP server does not declare QR-code login endpoints");
		const mcpUrl = await this.ensureRuntime(config.managedRuntimeId, config.managedRuntimeEnv);
		return { runtimeId: config.managedRuntimeId, baseUrl: new URL(mcpUrl).origin, setup: spec.setup };
	}

	private async request(
		target: SetupTarget,
		path: string,
		method: "GET" | "DELETE",
		requestController?: AbortController,
	): Promise<UpstreamEnvelope> {
		const controller = requestController ?? new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await this.fetchImpl(new URL(path, target.baseUrl), {
				method,
				redirect: "error",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`MCP login request failed: HTTP ${response.status}`);
			const body: unknown = await response.json();
			controller.signal.throwIfAborted();
			return parseEnvelope(body);
		} finally {
			clearTimeout(timer);
		}
	}
}

let service: McpSetupLoginService | undefined;

export function getDesktopMcpSetupLoginService(): McpSetupLoginService {
	service ??= new McpSetupLoginService();
	return service;
}
