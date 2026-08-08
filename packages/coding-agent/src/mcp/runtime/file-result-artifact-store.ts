import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	McpToolResultArtifact,
	McpToolResultArtifactStore,
	McpToolResultArtifactWriteRequest,
} from "@vetta/runtime-mcp";

export class FileMcpToolResultArtifactStore implements McpToolResultArtifactStore {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	async write(request: McpToolResultArtifactWriteRequest): Promise<McpToolResultArtifact> {
		const directory = join(this.root, safeSegment(request.sessionId));
		await mkdir(directory, { recursive: true });
		const fileName = `${safeSegment(request.serverName)}-${safeSegment(request.toolName)}-${randomUUID()}.json`;
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
		return rm(join(this.root, safeSegment(sessionId)), { force: true, recursive: true });
	}
}

function safeSegment(value: string): string {
	const readable =
		value
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "value";
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${readable}-${digest}`;
}
