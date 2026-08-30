import { randomUUID } from "node:crypto";
import {
	isMcpAppToolVisibleToApp,
	isMcpTaskCreatedError,
	type McpAppAttachment,
	type McpAppExecutionAttachmentRequest,
	type McpAppExecutionHost,
	type McpJsonObject,
	type McpTaskExecutionCoordinator,
	type McpToolCallResult,
	readMcpAppResource,
	readMcpAppToolMeta,
} from "@vetta/runtime-mcp";
import type { DesktopMcpAppSurface } from "../../shared/mcp-app.js";

const MAX_SURFACES = 64;
const MAX_HTML_BYTES = 1_000_000;
const MAX_SURFACE_RESULT_BYTES = 2_000_000;
const SURFACE_TTL_MS = 12 * 60 * 60_000;

interface SurfaceRecord {
	readonly surface: DesktopMcpAppSurface;
	readonly approvedTools: ReadonlySet<string>;
	readonly acquireClient: McpAppExecutionAttachmentRequest["acquireClient"];
	readonly serverName: string;
	readonly sessionId: string;
	readonly turnId: string;
	readonly createdAt: number;
}

export interface DesktopMcpAppRegistryOptions {
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly taskCoordinator?: McpTaskExecutionCoordinator;
}

/** In-memory capability registry. HTML, clients and credentials are never persisted into conversation history. */
export class DesktopMcpAppRegistry implements McpAppExecutionHost {
	private readonly records = new Map<string, SurfaceRecord>();
	private readonly now: () => number;
	private readonly createId: () => string;
	private readonly taskCoordinator?: McpTaskExecutionCoordinator;

	constructor(options: DesktopMcpAppRegistryOptions = {}) {
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? (() => `mcp-app-${randomUUID()}`);
		this.taskCoordinator = options.taskCoordinator;
	}

	async attach(request: McpAppExecutionAttachmentRequest): Promise<McpAppAttachment | undefined> {
		const resourceUri = readMcpAppToolMeta(request.tool._meta)?.resourceUri;
		if (!resourceUri) return undefined;
		const readResult = await request.client.readResource(resourceUri, {
			sessionId: request.context.sessionId,
			turnId: request.context.turnId,
			toolCallId: request.context.toolCallId,
		});
		const resource = readMcpAppResource(readResult.contents, resourceUri);
		if (!resource || new TextEncoder().encode(resource.html).byteLength > MAX_HTML_BYTES) return undefined;
		if (jsonByteLength(request.result) > MAX_SURFACE_RESULT_BYTES) return undefined;

		const approvedByConfig = new Set(request.autoApproveTools);
		const approvedTools = new Set(
			request.serverTools
				.filter((tool) => isMcpAppToolVisibleToApp(tool) && approvedByConfig.has(tool.name))
				.map((tool) => tool.name),
		);
		const id = this.createId();
		const surface: DesktopMcpAppSurface = {
			id,
			resource,
			toolResult: request.result,
			capabilities: { serverTools: approvedTools.size > 0, serverResources: true },
		};
		this.records.set(id, {
			surface,
			approvedTools,
			acquireClient: request.acquireClient,
			serverName: request.serverName,
			sessionId: request.context.sessionId,
			turnId: request.context.turnId,
			createdAt: this.now(),
		});
		this.prune();
		return { id, resourceUri, mimeType: resource.mimeType };
	}

	getSurface(id: string): DesktopMcpAppSurface | undefined {
		this.prune();
		return this.records.get(id)?.surface;
	}

	async callTool(id: string, name: string, args?: McpJsonObject): Promise<McpToolCallResult> {
		const record = this.requireRecord(id);
		if (!record.approvedTools.has(name)) throw new Error("MCP App tool call is not approved");
		const lease = record.acquireClient();
		try {
			if (!lease.client) throw new Error("MCP App server connection is unavailable");
			const context = {
				sessionId: record.sessionId,
				turnId: record.turnId,
				toolCallId: id,
				serverName: record.serverName,
				toolName: name,
			};
			let result: McpToolCallResult;
			try {
				result = await lease.client.callTool(name, args, context);
			} catch (error) {
				if (!isMcpTaskCreatedError(error) || !this.taskCoordinator) throw error;
				result = await this.taskCoordinator.waitForToolTaskResult(lease.client, error.result, { context });
			}
			if (jsonByteLength(result) > MAX_SURFACE_RESULT_BYTES) {
				throw new Error("MCP App tool result exceeds the host limit");
			}
			return result;
		} finally {
			await lease.release();
		}
	}

	async readResource(id: string, uri: string): Promise<unknown> {
		if (!uri.startsWith("ui://")) throw new Error("MCP App resources/read is limited to ui:// resources");
		const record = this.requireRecord(id);
		const lease = record.acquireClient();
		try {
			if (!lease.client) throw new Error("MCP App server connection is unavailable");
			const result = await lease.client.readResource(uri, {
				sessionId: record.sessionId,
				turnId: record.turnId,
				toolCallId: id,
			});
			if (jsonByteLength(result) > MAX_SURFACE_RESULT_BYTES) {
				throw new Error("MCP App resource result exceeds the host limit");
			}
			return result;
		} finally {
			await lease.release();
		}
	}

	release(id: string): boolean {
		return this.records.delete(id);
	}

	private requireRecord(id: string): SurfaceRecord {
		this.prune();
		const record = this.records.get(id);
		if (!record) throw new Error("MCP App surface is unavailable or expired");
		return record;
	}

	private prune(): void {
		const expiresBefore = this.now() - SURFACE_TTL_MS;
		for (const [id, record] of this.records) {
			if (record.createdAt < expiresBefore) this.records.delete(id);
		}
		while (this.records.size > MAX_SURFACES) {
			const oldest = this.records.keys().next().value as string | undefined;
			if (!oldest) break;
			this.records.delete(oldest);
		}
	}
}

function jsonByteLength(value: unknown): number {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}
