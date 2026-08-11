import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
	CodingToolResultArtifact,
	CodingToolResultArtifactStore,
	CodingToolResultArtifactWriteRequest,
} from "./contracts.js";

export class FileCodingToolResultArtifactStore implements CodingToolResultArtifactStore {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	async write(request: CodingToolResultArtifactWriteRequest): Promise<CodingToolResultArtifact> {
		const directory = join(this.root, safeSessionArtifactSegment(request.sessionId));
		await mkdir(directory, { recursive: true });
		const targetPath = join(directory, `${safeSessionArtifactSegment(request.toolName)}-${randomUUID()}.json`);
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
		return rm(join(this.root, safeSessionArtifactSegment(sessionId)), { force: true, recursive: true });
	}
}

export function safeSessionArtifactSegment(value: string): string {
	const readable =
		value
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "value";
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${readable}-${digest}`;
}
