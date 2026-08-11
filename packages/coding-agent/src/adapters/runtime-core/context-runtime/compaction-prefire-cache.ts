import type { Api, Model } from "@vetta/ai";
import {
	type CompactionPreparation,
	type CompactionResult,
	type CompactionSettings,
	fingerprintCompactionPrefix,
	isPrefireCacheValid,
	type PrefireCache,
	prepareCompaction,
} from "../../../compaction/index.js";
import type { CodingAgentSessionEntry as SessionEntry } from "../../../sessions/index.js";
import type { CodingAgentContextRuntimeOptions } from "./contracts.js";

export interface CompactionPrefireCacheOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
	readonly canAttempt: () => boolean;
}

export class CompactionPrefireCache {
	private cache: PrefireCache | undefined;
	private abortController: AbortController | undefined;
	private disposed = false;

	constructor(private readonly options: CompactionPrefireCacheOptions) {}

	start(entries: readonly SessionEntry[], settings: CompactionSettings, model: Model<Api>): void {
		if (this.abortController || this.disposed || !this.options.canAttempt()) return;
		const preparation = prepareCompaction([...entries], settings);
		if (!preparation) return;
		const fingerprint = fingerprintCompactionPrefix([...entries], preparation.firstKeptEntryId);
		if (!fingerprint || this.cache?.fingerprint === fingerprint) return;

		const controller = new AbortController();
		this.abortController = controller;
		void this.generate(preparation, fingerprint, model, controller.signal).finally(() => {
			if (this.abortController === controller) this.abortController = undefined;
		});
	}

	take(entries: readonly SessionEntry[]): CompactionResult | undefined {
		const cache = this.cache;
		if (!cache) return undefined;
		this.cache = undefined;
		return isPrefireCacheValid(cache, [...entries]) ? cache.result : undefined;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.abortController?.abort();
		this.abortController = undefined;
		this.cache = undefined;
	}

	private async generate(
		preparation: CompactionPreparation,
		fingerprint: string,
		model: Model<Api>,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const apiKey = await this.options.resolveApiKey(model);
			if (!apiKey) return;
			const result = await this.options.generateCompaction(preparation, model, apiKey, undefined, signal);
			if (signal.aborted || this.disposed) return;
			this.cache = { fingerprint, result };
			console.info(
				`[compaction] prefire cached (tokensBefore=${result.tokensBefore}, firstKept=${result.firstKeptEntryId})`,
			);
		} catch {
			// Prefire is best-effort and does not affect the circuit breaker.
		}
	}
}
