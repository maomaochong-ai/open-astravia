import type { DesktopMcpAppSurface } from "@preload/api";

const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

type JsonRpcId = string | number;
interface JsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id: JsonRpcId;
	readonly method: string;
	readonly params?: unknown;
}
interface JsonRpcNotification {
	readonly jsonrpc: "2.0";
	readonly method: string;
	readonly params?: unknown;
}
type JsonRpcMessage =
	| JsonRpcRequest
	| JsonRpcNotification
	| { readonly jsonrpc: "2.0"; readonly id: JsonRpcId; readonly result?: unknown; readonly error?: unknown };

export interface DesktopMcpAppBridgeOptions {
	readonly surface: DesktopMcpAppSurface;
	readonly targetWindow: Window;
	readonly input: Readonly<Record<string, unknown>>;
	readonly post: (message: JsonRpcMessage) => void;
	readonly hostContext?: Readonly<Record<string, unknown>>;
	readonly onSizeChanged?: (height: number) => void;
}

export class DesktopMcpAppBridge {
	private initialized = false;
	private initializeAccepted = false;
	private toolStateQueued = false;
	private readonly queued: JsonRpcNotification[] = [];
	private nextId = 1;
	private readonly pending = new Map<JsonRpcId, { resolve(value: unknown): void }>();

	constructor(private readonly options: DesktopMcpAppBridgeOptions) {}

	handle(data: unknown): void {
		if (!isJsonRpcMessage(data)) return;
		if (!("method" in data)) {
			this.resolveResponse(data);
			return;
		}
		if ("id" in data) void this.handleRequest(data);
		else this.handleNotification(data);
	}

	sendInitialToolState(): void {
		if (this.toolStateQueued) return;
		this.toolStateQueued = true;
		this.send({ method: "ui/notifications/tool-input", params: { arguments: this.options.input } });
		this.send({ method: "ui/notifications/tool-result", params: this.options.surface.toolResult });
	}

	requestTeardown(reason: string): Promise<unknown> {
		if (!this.initialized) return Promise.resolve(undefined);
		const id = this.nextId++;
		this.options.post({ jsonrpc: "2.0", id, method: "ui/resource-teardown", params: { reason } });
		return new Promise((resolve) => this.pending.set(id, { resolve }));
	}

	close(): void {
		for (const waiter of this.pending.values()) waiter.resolve(undefined);
		this.pending.clear();
		this.queued.length = 0;
	}

	private async handleRequest(request: JsonRpcRequest): Promise<void> {
		try {
			const result = await this.dispatch(request.method, request.params);
			this.options.post({ jsonrpc: "2.0", id: request.id, result });
		} catch (error) {
			const code = error instanceof McpAppBridgeError ? error.code : -32603;
			this.options.post({
				jsonrpc: "2.0",
				id: request.id,
				error: { code, message: error instanceof Error ? error.message : "Invalid MCP App request" },
			});
		}
	}

	private async dispatch(method: string, params: unknown): Promise<unknown> {
		if (method === "ui/initialize" && this.initializeAccepted) {
			throw new McpAppBridgeError(-32600, "MCP App is already initialized");
		}
		if (method !== "ui/initialize" && method !== "ping" && !this.initialized) {
			throw new McpAppBridgeError(-32002, "MCP App initialization is not complete");
		}
		switch (method) {
			case "ui/initialize":
				assertInitializeParams(params);
				this.initializeAccepted = true;
				return {
					protocolVersion: MCP_APP_PROTOCOL_VERSION,
					hostCapabilities: {
						...(this.options.surface.capabilities.serverTools ? { serverTools: {} } : {}),
						serverResources: {},
					},
					hostInfo: { name: "Vetta Desktop", version: "1" },
					hostContext: {
						displayMode: "inline",
						availableDisplayModes: ["inline"],
						platform: "desktop",
						containerDimensions: { maxHeight: 800 },
						...this.options.hostContext,
					},
				};
			case "ping":
				return {};
			case "tools/call": {
				const call = readToolCall(params);
				return await window.vetta.session.callMcpAppTool({ surfaceId: this.options.surface.id, ...call });
			}
			case "resources/read": {
				const uri = readResourceUri(params);
				return await window.vetta.session.readMcpAppResource({ surfaceId: this.options.surface.id, uri });
			}
			case "ui/request-display-mode":
				assertInlineDisplayMode(params);
				return { mode: "inline" };
			default:
				throw new McpAppBridgeError(-32601, `Unsupported MCP App method: ${method}`);
		}
	}

	private handleNotification(notification: JsonRpcNotification): void {
		if (notification.method === "ui/notifications/initialized") {
			if (!this.initializeAccepted) return;
			this.initialized = true;
			for (const message of this.queued.splice(0)) this.options.post(message);
			this.sendInitialToolState();
			return;
		}
		if (notification.method === "ui/notifications/size-changed") {
			const params = isRecord(notification.params) ? notification.params : undefined;
			if (typeof params?.height === "number" && Number.isFinite(params.height)) {
				this.options.onSizeChanged?.(Math.min(800, Math.max(160, Math.round(params.height))));
			}
		}
	}

	private send(message: Omit<JsonRpcNotification, "jsonrpc">): void {
		const notification = { jsonrpc: "2.0" as const, ...message };
		if (!this.initialized) this.queued.push(notification);
		else this.options.post(notification);
	}

	private resolveResponse(response: { readonly id: JsonRpcId; readonly result?: unknown }): void {
		const waiter = this.pending.get(response.id);
		if (!waiter) return;
		this.pending.delete(response.id);
		waiter.resolve(response.result);
	}
}

function readToolCall(value: unknown): { name: string; arguments?: Record<string, unknown> } {
	if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0) {
		throw new McpAppBridgeError(-32602, "Invalid tools/call params");
	}
	if (value.arguments !== undefined && !isRecord(value.arguments)) {
		throw new McpAppBridgeError(-32602, "Invalid tools/call arguments");
	}
	return { name: value.name, ...(isRecord(value.arguments) ? { arguments: value.arguments } : {}) };
}

function readResourceUri(value: unknown): string {
	if (!isRecord(value) || typeof value.uri !== "string" || !value.uri.startsWith("ui://")) {
		throw new McpAppBridgeError(-32602, "resources/read is limited to ui:// resources");
	}
	return value.uri;
}

function assertInitializeParams(value: unknown): void {
	if (!isRecord(value) || !isRecord(value.appCapabilities)) {
		throw new McpAppBridgeError(-32602, "Invalid ui/initialize params");
	}
}

function assertInlineDisplayMode(value: unknown): void {
	if (!isRecord(value) || (value.mode !== "inline" && value.mode !== "fullscreen" && value.mode !== "pip")) {
		throw new McpAppBridgeError(-32602, "Invalid ui/request-display-mode params");
	}
}

class McpAppBridgeError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
		this.name = "McpAppBridgeError";
	}
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
	if (!isRecord(value) || value.jsonrpc !== "2.0") return false;
	if ("method" in value) {
		if (typeof value.method !== "string") return false;
		return value.id === undefined || typeof value.id === "string" || typeof value.id === "number";
	}
	return typeof value.id === "string" || typeof value.id === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
