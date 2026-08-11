import type { AssistantMessage } from "@vetta/ai";
import type { ContextCompactionRecord, StoredSessionEvent } from "@vetta/runtime-core/kernel";
import { type CodingToolRegistration, createMemoryToolRegistration } from "@vetta/runtime-tools/coding";
import { renderMemoryForPrompt } from "../model-context/index.js";
import { AiMemoryFactExtractor } from "./ai-memory-fact-extractor.js";
import { FileMemoryJournal } from "./file-memory-journal.js";
import { DEFAULT_MEMORY_CHAR_LIMIT } from "./memory-document.js";
import { MemoryFlushService } from "./memory-flush-service.js";
import type {
	CodingAgentMemoryFlushInput,
	CodingAgentMemoryPromptState,
	CodingAgentMemoryRolloverOrchestratorOptions,
	CodingAgentMemoryRolloverPreparation,
	CodingAgentMemoryRolloverRuntime,
} from "./memory-runtime-contract.js";
import { FileMemoryStore } from "./memory-store.js";

export class CodingAgentMemoryRolloverOrchestrator implements CodingAgentMemoryRolloverRuntime {
	readonly id = "coding-agent.memory-rollover";
	readonly toolRegistration: CodingToolRegistration;
	private readonly memoryFile: string;
	private readonly cwd: string;
	private readonly memoryCharLimit: number;
	private readonly frozenMemorySnapshot: string;
	private readonly flushMemory: NonNullable<CodingAgentMemoryRolloverOrchestratorOptions["flushMemory"]>;
	private readonly appendTurnJournal: NonNullable<CodingAgentMemoryRolloverOrchestratorOptions["appendTurnJournal"]>;
	private readonly appendRolloverJournal: NonNullable<
		CodingAgentMemoryRolloverOrchestratorOptions["appendRolloverJournal"]
	>;
	private readonly lastAssistantByTurn = new Map<string, AssistantMessage>();

	constructor(options: CodingAgentMemoryRolloverOrchestratorOptions) {
		this.memoryFile = options.memoryFile;
		this.cwd = options.cwd;
		this.memoryCharLimit = options.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT;
		const store = new FileMemoryStore({ path: this.memoryFile, charLimit: this.memoryCharLimit });
		const journal = new FileMemoryJournal();
		const flushService = new MemoryFlushService(store, new AiMemoryFactExtractor());
		this.frozenMemorySnapshot = store.readContent();
		this.flushMemory =
			options.flushMemory ??
			((input) =>
				flushService.flush({
					messages: input.messages,
					model: input.model,
					apiKey: input.apiKey,
					signal: input.signal,
				}));
		this.appendTurnJournal = options.appendTurnJournal ?? ((cwd, message) => journal.appendTurn(cwd, message));
		this.appendRolloverJournal =
			options.appendRolloverJournal ?? ((cwd, summary) => journal.appendRollover(cwd, summary));
		this.toolRegistration = createMemoryToolRegistration({ operations: store });
	}

	readPromptMemory(): CodingAgentMemoryPromptState {
		return {
			enabled: true,
			file: this.memoryFile,
			snapshot: this.frozenMemorySnapshot,
			charLimit: this.memoryCharLimit,
		};
	}

	renderPromptMemory(): string {
		return renderMemoryForPrompt(this.memoryFile, this.frozenMemorySnapshot, this.memoryCharLimit);
	}

	adjustCompactionSettings(
		settings: Parameters<CodingAgentMemoryRolloverRuntime["adjustCompactionSettings"]>[0],
		contextWindow: number,
	) {
		return {
			...settings,
			minFreePercent: Math.max(settings.minFreePercent, 30),
			reserveTokens:
				contextWindow > 0
					? Math.max(settings.reserveTokens, Math.ceil(contextWindow * 0.3))
					: settings.reserveTokens,
		};
	}

	async beforeCompaction(input: CodingAgentMemoryRolloverPreparation): Promise<void> {
		await this.flushMessages({
			messages: input.preparation.messagesToSummarize,
			model: input.model,
			apiKey: input.apiKey,
			signal: input.signal,
		});
	}

	async flushMessages(input: CodingAgentMemoryFlushInput): Promise<number> {
		try {
			const written = await this.flushMemory({
				...input,
				memoryFile: this.memoryFile,
				limit: this.memoryCharLimit,
			});
			return written.length;
		} catch {
			return 0;
		}
	}

	beforeContinuation(record: ContextCompactionRecord): void {
		try {
			this.appendRolloverJournal(this.cwd, record.summary);
		} catch {
			// JOURNAL 是 best-effort，并且发生在 rollover 事务之前。
		}
	}

	continuationAfterCompaction() {
		return { reason: "memory-rollover" as const };
	}

	async observe(event: StoredSessionEvent): Promise<void> {
		if (event.type === "message.appended" && event.message.role === "assistant") {
			this.lastAssistantByTurn.set(event.turnId, event.message);
			return;
		}
		if (event.type === "turn.completed") {
			const message = this.lastAssistantByTurn.get(event.turnId);
			this.lastAssistantByTurn.delete(event.turnId);
			if (!message) return;
			try {
				this.appendTurnJournal(this.cwd, message);
			} catch {
				// JOURNAL 失败不能改变 Turn 终态。
			}
			return;
		}
		if (event.type === "turn.cancelled" || event.type === "turn.failed") {
			this.lastAssistantByTurn.delete(event.turnId);
		}
	}

	dispose(): void {
		this.lastAssistantByTurn.clear();
	}
}
