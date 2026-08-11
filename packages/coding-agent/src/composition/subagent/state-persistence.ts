import { randomUUID } from "node:crypto";
import type {
	ConversationDocument,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "@vetta/runtime-core";
import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";
import type { SubagentDeliveryMarker, SubagentRecoveryState, SubagentSnapshot } from "@vetta/runtime-subagents";
import { z } from "zod";

export const CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE = "subagent_state_v1";

const SubagentStatusSchema = z.enum(["queued", "pending", "running", "completed", "failed", "interrupted"]);
const SubagentUsageSchema = z
	.object({
		input: z.number().finite(),
		output: z.number().finite(),
		cacheRead: z.number().finite(),
		cacheWrite: z.number().finite(),
		costTotal: z.number().finite(),
	})
	.strict();
const SubagentSnapshotSchema = z
	.object({
		id: z.string().min(1),
		taskName: z.string().min(1),
		path: z.string().min(1),
		agentType: z.string().min(1),
		status: SubagentStatusSchema,
		task: z.string(),
		parentSessionId: z.string().min(1),
		sessionFile: z.string().min(1).optional(),
		startedAt: z.number().finite(),
		endedAt: z.number().finite().optional(),
		finalText: z.string().optional(),
		errorMessage: z.string().optional(),
		usage: SubagentUsageSchema,
		generation: z.number().int().nonnegative(),
		todoProgress: z
			.object({
				done: z.number().int().nonnegative(),
				total: z.number().int().nonnegative(),
			})
			.strict()
			.optional(),
		title: z.string().optional(),
	})
	.strict();
const SubagentStateEventSchema = z.discriminatedUnion("event", [
	z
		.object({
			version: z.literal(1),
			event: z.literal("upsert"),
			snapshot: SubagentSnapshotSchema,
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			event: z.literal("remove"),
			id: z.string().min(1),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			event: z.literal("delivery_claimed"),
			id: z.string().min(1),
			generation: z.number().int().nonnegative(),
		})
		.strict(),
]);

type SubagentStateEvent = z.infer<typeof SubagentStateEventSchema>;

export interface CodingAgentSubagentStatePersistenceOptions {
	readonly restore: (state: SubagentRecoveryState) => void | Promise<void>;
	readonly onRecoveryIssue?: (message: string) => void;
	readonly createEntryId?: () => string;
	readonly now?: () => number;
}

/**
 * 将 Coding Agent Session-local Subagent 状态映射为父 Conversation Document 的增量事件。
 *
 * Runtime Subagent Coordinator 不依赖存储；该 Participant 只负责持久化校验、折叠与串行提交。
 */
export class CodingAgentSubagentStatePersistence implements RuntimeDocumentParticipant {
	private readonly createEntryId: () => string;
	private readonly now: () => number;
	private readonly knownAgents = new Map<string, SubagentSnapshot>();
	private readonly delivered = new Map<string, SubagentDeliveryMarker>();
	private context: RuntimeDocumentParticipantContext | undefined;
	private persistenceTail: Promise<void> = Promise.resolve();
	private latestPersistence: Promise<void> = Promise.resolve();
	private documentWriteDepth = 0;
	private initialized = false;
	private disposed = false;

	constructor(private readonly options: CodingAgentSubagentStatePersistenceOptions) {
		this.createEntryId = options.createEntryId ?? randomUUID;
		this.now = options.now ?? Date.now;
	}

	async initialize(document: ConversationDocument, context: RuntimeDocumentParticipantContext): Promise<void> {
		if (this.initialized) throw new Error("Coding Agent Subagent state persistence is already initialized");
		this.initialized = true;
		this.context = context;
		const state = this.readRecoveryState(document);
		for (const snapshot of state.agents) this.knownAgents.set(snapshot.id, cloneSnapshot(snapshot));
		for (const marker of state.delivered) this.delivered.set(deliveryKey(marker), marker);
		await this.options.restore(state);
	}

	async onDocumentChanged(document: ConversationDocument): Promise<void> {
		if (this.disposed || !this.initialized || this.documentWriteDepth > 0) return;
		const persisted = this.readRecoveryState(document);
		const persistedAgents = new Map(persisted.agents.map((snapshot) => [snapshot.id, snapshot]));
		const persistedDeliveries = new Set(persisted.delivered.map(deliveryKey));
		for (const [id, snapshot] of this.knownAgents) {
			const current = persistedAgents.get(id);
			if (!current || !snapshotsEqual(current, snapshot)) {
				this.schedule({ version: 1, event: "upsert", snapshot });
			}
		}
		for (const id of persistedAgents.keys()) {
			if (!this.knownAgents.has(id)) this.schedule({ version: 1, event: "remove", id });
		}
		for (const [key, marker] of this.delivered) {
			if (persistedDeliveries.has(key)) continue;
			this.schedule({
				version: 1,
				event: "delivery_claimed",
				id: marker.id,
				generation: marker.generation,
			});
		}
		await this.flush();
	}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "message.appended" && event.message.role === "toolResult") {
			await this.flush();
			return;
		}
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
			await this.flush();
		}
	}

	recordSnapshots(agents: readonly SubagentSnapshot[]): void {
		if (this.disposed) return;
		const next = new Map(agents.map((snapshot) => [snapshot.id, cloneSnapshot(snapshot)]));
		for (const [id, snapshot] of next) {
			const previous = this.knownAgents.get(id);
			if (previous && snapshotsEqual(previous, snapshot)) continue;
			this.schedule({ version: 1, event: "upsert", snapshot });
		}
		for (const id of this.knownAgents.keys()) {
			if (!next.has(id)) this.schedule({ version: 1, event: "remove", id });
		}
		this.knownAgents.clear();
		for (const [id, snapshot] of next) this.knownAgents.set(id, snapshot);
	}

	recordDelivery(marker: SubagentDeliveryMarker): void {
		if (this.disposed) return;
		const key = deliveryKey(marker);
		if (this.delivered.has(key)) return;
		this.delivered.set(key, marker);
		this.schedule({
			version: 1,
			event: "delivery_claimed",
			id: marker.id,
			generation: marker.generation,
		});
	}

	async flush(): Promise<void> {
		await this.latestPersistence;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.flush();
		this.context = undefined;
	}

	private readRecoveryState(document: ConversationDocument): SubagentRecoveryState {
		const agents = new Map<string, SubagentSnapshot>();
		const delivered = new Map<string, SubagentDeliveryMarker>();
		for (const entry of document.entries) {
			if (entry.type !== "custom" || entry.customType !== CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE) continue;
			const parsed = SubagentStateEventSchema.safeParse(entry.data);
			if (!parsed.success) {
				this.options.onRecoveryIssue?.(
					`Invalid ${CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE} entry "${entry.id}": ${z.prettifyError(parsed.error)}`,
				);
				continue;
			}
			const event = parsed.data;
			if (event.event === "upsert") agents.set(event.snapshot.id, cloneSnapshot(event.snapshot));
			if (event.event === "remove") agents.delete(event.id);
			if (event.event === "delivery_claimed") {
				const marker = { id: event.id, generation: event.generation };
				delivered.set(deliveryKey(marker), marker);
			}
		}
		return {
			agents: [...agents.values()],
			delivered: [...delivered.values()],
		};
	}

	private schedule(event: SubagentStateEvent): void {
		const context = this.context;
		if (!context) return;
		const operation = this.persistenceTail.then(async () => {
			this.documentWriteDepth += 1;
			try {
				await context.appendCustomEntry({
					entryId: this.createEntryId(),
					customType: CODING_AGENT_SUBAGENT_STATE_CUSTOM_TYPE,
					data: event,
					timestamp: new Date(this.now()).toISOString(),
				});
			} finally {
				this.documentWriteDepth -= 1;
			}
		});
		this.latestPersistence = operation;
		this.persistenceTail = operation.catch(() => undefined);
	}
}

function deliveryKey(marker: SubagentDeliveryMarker): string {
	return `${marker.id}#${marker.generation}`;
}

function cloneSnapshot(snapshot: SubagentSnapshot): SubagentSnapshot {
	return {
		...snapshot,
		usage: { ...snapshot.usage },
		todoProgress: snapshot.todoProgress ? { ...snapshot.todoProgress } : undefined,
	};
}

function snapshotsEqual(left: SubagentSnapshot, right: SubagentSnapshot): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
