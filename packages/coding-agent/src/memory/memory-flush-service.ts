import type { AgentMessage } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type { MemoryFactExtractor } from "./memory-fact-extractor.js";
import type { MemoryStore } from "./memory-store.js";

export interface MemoryFlushInput {
	readonly messages: readonly AgentMessage[];
	readonly model: Model<Api>;
	readonly apiKey: string;
	readonly signal: AbortSignal;
}

export class MemoryFlushService {
	constructor(
		private readonly store: MemoryStore,
		private readonly extractor: MemoryFactExtractor,
	) {}

	async flush(input: MemoryFlushInput): Promise<readonly string[]> {
		try {
			const candidates = await this.extractor.extract({
				...input,
				currentEntries: this.store.readEntries(),
			});
			const written: string[] = [];
			for (const candidate of candidates) {
				const duplicate = this.store
					.readEntries()
					.some((entry) => entry.includes(candidate) || candidate.includes(entry));
				if (duplicate) continue;
				try {
					this.store.apply("add", { content: candidate });
					written.push(candidate);
				} catch {
					break;
				}
			}
			return written;
		} catch {
			return [];
		}
	}
}
