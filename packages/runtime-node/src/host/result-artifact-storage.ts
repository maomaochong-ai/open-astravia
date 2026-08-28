import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpToolResultArtifactStore, McpToolResultArtifactWriteRequest } from "@vetta/runtime-mcp";
import type { RuntimeToolResultArtifactStore, RuntimeToolResultArtifactWriteRequest } from "@vetta/runtime-tools";

interface ResultArtifactWriteRequest {
	readonly sessionId: string;
	readonly data: string;
}

export interface NodeSessionArtifactStore {
	deleteSessionArtifacts(sessionId: string): Promise<void>;
}

abstract class NodeFileResultArtifactStore<Request extends ResultArtifactWriteRequest>
	implements NodeSessionArtifactStore
{
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	protected async writeArtifact(request: Request, nameSegments: readonly string[]): Promise<{ reference: string }> {
		const directory = join(this.root, safeResultArtifactSegment(request.sessionId));
		await mkdir(directory, { recursive: true });
		const fileName = `${nameSegments.map(safeResultArtifactSegment).join("-")}-${randomUUID()}.json`;
		const targetPath = join(directory, fileName);
		const temporaryPath = `${targetPath}.tmp`;
		try {
			await writeFile(temporaryPath, request.data, "utf8");
			await rename(temporaryPath, targetPath);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			throw error;
		}
		return { reference: targetPath };
	}

	deleteSessionArtifacts(sessionId: string): Promise<void> {
		return rm(join(this.root, safeResultArtifactSegment(sessionId)), { force: true, recursive: true });
	}
}

export class NodeCodingToolResultArtifactStore
	extends NodeFileResultArtifactStore<RuntimeToolResultArtifactWriteRequest>
	implements RuntimeToolResultArtifactStore
{
	write(request: RuntimeToolResultArtifactWriteRequest): Promise<{ reference: string }> {
		return this.writeArtifact(request, [request.toolName]);
	}
}

export class NodeMcpToolResultArtifactStore
	extends NodeFileResultArtifactStore<McpToolResultArtifactWriteRequest>
	implements McpToolResultArtifactStore
{
	write(request: McpToolResultArtifactWriteRequest): Promise<{ reference: string }> {
		return this.writeArtifact(request, [request.serverName, request.toolName]);
	}
}

export class CompositeNodeSessionArtifactCleaner implements NodeSessionArtifactStore {
	constructor(private readonly stores: readonly NodeSessionArtifactStore[]) {}

	async deleteSessionArtifacts(sessionId: string): Promise<void> {
		await Promise.all(this.stores.map((store) => store.deleteSessionArtifacts(sessionId)));
	}
}

export interface NodeResultArtifactStorage {
	readonly coding: NodeCodingToolResultArtifactStore;
	readonly mcp: NodeMcpToolResultArtifactStore;
	readonly cleaner: NodeSessionArtifactStore;
}

export interface NodeResultArtifactStorageOptions {
	readonly codingRoot: string;
	readonly mcpRoot: string;
}

export function createNodeResultArtifactStorage(options: NodeResultArtifactStorageOptions): NodeResultArtifactStorage {
	const coding = new NodeCodingToolResultArtifactStore(options.codingRoot);
	const mcp = new NodeMcpToolResultArtifactStore(options.mcpRoot);
	return {
		coding,
		mcp,
		cleaner: new CompositeNodeSessionArtifactCleaner([coding, mcp]),
	};
}

function safeResultArtifactSegment(value: string): string {
	const readable =
		value
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "value";
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${readable}-${digest}`;
}
