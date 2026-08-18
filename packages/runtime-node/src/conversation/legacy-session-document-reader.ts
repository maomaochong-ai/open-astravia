import { readFile } from "node:fs/promises";
import type { ConversationDocument, ConversationDocumentReader } from "@vetta/runtime-core/conversation";
import {
	type LegacySessionDocumentSource,
	parseLegacySessionDocument,
	parseLegacySessionDocumentSource,
} from "@vetta/runtime-storage/conversation";

export interface LegacySessionDocumentReaderOptions {
	readonly resolvePath: (sessionId: string) => string;
}

/** Node file reader for the platform-neutral Legacy JSONL parser. */
export class LegacySessionDocumentReader implements ConversationDocumentReader {
	constructor(private readonly options: LegacySessionDocumentReaderOptions) {}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		const document = await readLegacySessionDocument(this.options.resolvePath(sessionId));
		if (document.identity.sessionId !== sessionId) {
			throw new Error(`Legacy session ${document.identity.sessionId} does not match ${sessionId}`);
		}
		return document;
	}
}

export async function readLegacySessionDocument(path: string): Promise<ConversationDocument> {
	return (await readLegacySessionDocumentSource(path)).document;
}

export async function readLegacySessionDocumentSource(path: string): Promise<LegacySessionDocumentSource> {
	return parseLegacySessionDocumentSource(await readFile(path, "utf8"));
}

export { parseLegacySessionDocument, parseLegacySessionDocumentSource, type LegacySessionDocumentSource };
