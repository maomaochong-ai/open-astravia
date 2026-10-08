import type { AssistantMessage } from "@astravia/ai";
import type { ContextCompactionRecord, StoredSessionEvent } from "@astravia/runtime-core/kernel";
import { renderMemoryForPrompt } from "../model-context/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../runtime-contracts/index.js";
import { AiMemoryFactExtractor } from "./ai-memory-fact-extractor.js";
import { DEFAULT_MEMORY_CHAR_LIMIT } from "./memory-document.js";
import { MemoryFlushService } from "./memory-flush-service.js";
import { MemoryJournalWriter } from "./memory-journal.js";
import type {
	CodingAgentMemoryFlushInput,
	CodingAgentMemoryPromptState,
	CodingAgentMemoryRolloverOrchestratorOptions,
	CodingAgentMemoryRolloverPreparation,
	CodingAgentMemoryRolloverRuntime,
	CodingAgentMemoryScopeSnapshot,
} from "./memory-runtime-contract.js";
import { MemoryDocumentStore, type MemoryScopeBinding, ScopedMemoryStore } from "./memory-store.js";
import { createMemoryToolRegistration } from "./memory-tool-registration.js";

export class CodingAgentMemoryRolloverOrchestrator implements CodingAgentMemoryRolloverRuntime {
	readonly id = "coding-agent.memory-rollover";
	readonly toolRegistration: CodingAgentRuntimeToolRegistration;
	private readonly memoryFile: string;
	private readonly cwd: string;
	private readonly memoryCharLimit: number;
	private readonly projectStore: MemoryDocumentStore;
	private readonly scopes: readonly CodingAgentMemoryScopeSnapshot[];
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
		const bindings: MemoryScopeBinding[] = [];
		if (options.userMemoryFile !== undefined && options.userMemoryStorage !== undefined) {
			bindings.push({
				scope: "user",
				file: options.userMemoryFile,
				store: new MemoryDocumentStore({
					storage: options.userMemoryStorage,
					charLimit: this.memoryCharLimit,
				}),
			});
		}
		this.projectStore = new MemoryDocumentStore({
			storage: options.memoryStorage,
			charLimit: this.memoryCharLimit,
		});
		bindings.push({ scope: "project", file: this.memoryFile, store: this.projectStore });
		// 快照在会话开始时冻结一次：提示词缓存因此保持稳定（ADR-0009）。
		this.scopes = bindings.map((binding) => ({
			scope: binding.scope,
			file: binding.file,
			snapshot: binding.store.readContent(),
		}));
		const journal = new MemoryJournalWriter(options.journalStorage);
		const flushService = new MemoryFlushService(this.projectStore, new AiMemoryFactExtractor());
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
		this.toolRegistration = createMemoryToolRegistration({
			// 缺省写入最有持久性的已配置作用域：单作用域宿主行为不变。
			operations: new ScopedMemoryStore({
				defaultScope: bindings.some((binding) => binding.scope === "user") ? "user" : "project",
				bindings,
			}),
		});
	}

	readPromptMemory(): CodingAgentMemoryPromptState {
		return {
			enabled: true,
			charLimit: this.memoryCharLimit,
			scopes: this.scopes,
		};
	}

	renderPromptMemory(): string {
		return renderMemoryForPrompt(this.scopes, this.memoryCharLimit);
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
