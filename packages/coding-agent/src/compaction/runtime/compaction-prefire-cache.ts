import type { Api, Model } from "@vetta/ai";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "@vetta/runtime-core";
import { CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION } from "../../runtime-contracts/context-observability.js";
import type { CodingAgentContextRuntimeOptions } from "../../runtime-contracts/index.js";
import type { CodingAgentSessionEntry as SessionEntry } from "../../sessions/index.js";
import {
	type CompactionPreparation,
	type CompactionResult,
	type CompactionSettings,
	fingerprintCompactionPrefix,
	isPrefireCacheValid,
	type PrefireCache,
	prepareCompaction,
} from "../index.js";

export interface CompactionPrefireCacheOptions {
	readonly resolveApiKey: CodingAgentContextRuntimeOptions["resolveApiKey"];
	readonly generateCompaction: NonNullable<CodingAgentContextRuntimeOptions["generateCompaction"]>;
	readonly canAttempt: () => boolean;
	readonly observations?: RuntimeObservationPublisher;
}

export class CompactionPrefireCache {
	private cache: PrefireCache | undefined;
	private abortController: AbortController | undefined;
	private disposed = false;

	constructor(private readonly options: CompactionPrefireCacheOptions) {}

	start(
		entries: readonly SessionEntry[],
		settings: CompactionSettings,
		model: Model<Api>,
		credential?: { resolve(): Promise<string | undefined> | string | undefined },
	): void {
		if (this.abortController || this.disposed || !this.options.canAttempt()) return;
		const preparation = prepareCompaction([...entries], settings);
		if (!preparation) return;
		const fingerprint = fingerprintCompactionPrefix([...entries], preparation.firstKeptEntryId);
		if (!fingerprint || this.cache?.fingerprint === fingerprint) return;

		const controller = new AbortController();
		this.abortController = controller;
		void this.generate(preparation, fingerprint, model, credential, controller.signal).finally(() => {
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
		credential: { resolve(): Promise<string | undefined> | string | undefined } | undefined,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const apiKey = credential ? await credential.resolve() : await this.options.resolveApiKey(model);
			if (!apiKey) return;
			const result = await this.options.generateCompaction(preparation, model, apiKey, undefined, signal);
			if (signal.aborted || this.disposed) return;
			this.cache = { fingerprint, result };
			this.options.observations?.record(CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION, {
				phase: "cached",
				tokensBefore: result.tokensBefore,
			});
		} catch (error) {
			this.options.observations?.record(CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION, {
				phase: signal.aborted ? "cancelled" : "failed",
				failure: runtimeObservationFailure(error, signal),
			});
			// Prefire is best-effort and does not affect the compaction circuit breaker.
		}
	}
}
