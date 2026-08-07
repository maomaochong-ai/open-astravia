import { randomUUID } from "node:crypto";
import type {
	ConversationDocument,
	GreenfieldRuntimeDocumentParticipantContext,
	RuntimeSessionTodoController,
} from "@vetta/runtime-core";
import { selectConversationDocumentEntries } from "@vetta/runtime-core";
import type { AgentFeatureDefinition, StoredSessionEvent } from "@vetta/runtime-core/kernel";
import {
	type CodingToolRegistration,
	createTodoToolRegistration,
	type TodoToolInput,
} from "@vetta/runtime-tools/coding";
import type { CodingAgentTodoRuntime as CodingAgentTodoRuntimePort } from "../../runtime-contracts/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import {
	parseTodoSnapshot,
	TODO_SNAPSHOT_TYPE,
	type TodoLockSource,
	type TodoSnapshot,
	type TodoSnapshotEnvelope,
	TodoState,
} from "../../work-state/index.js";

export interface CodingAgentTodoRuntimeOptions {
	readonly state?: TodoState;
	readonly createEntryId?: () => string;
	readonly now?: () => number;
}

/**
 * 一个 Session 内 Todo 的唯一状态所有者。
 *
 * Tool、Continuation、Prompt Scene 与宿主 Controller 都读取同一个 TodoStore；
 * Runtime Core 仅通过通用 Conversation Document participant 保存 custom entry。
 */
export class CodingAgentTodoRuntime implements CodingAgentTodoRuntimePort {
	private readonly state: TodoState;
	private readonly createEntryId: () => string;
	private readonly now: () => number;
	private documentContext: GreenfieldRuntimeDocumentParticipantContext | undefined;
	private unsubscribe: (() => void) | undefined;
	private persistenceTail: Promise<void> = Promise.resolve();
	private latestPersistence: Promise<void> = Promise.resolve();
	private readonly pendingSnapshots: TodoSnapshotEnvelope[] = [];
	private activeTurn = false;
	private restoring = false;
	private disposed = false;

	constructor(options: CodingAgentTodoRuntimeOptions = {}) {
		this.state = options.state ?? new TodoState();
		this.createEntryId = options.createEntryId ?? randomUUID;
		this.now = options.now ?? Date.now;
	}

	getAll(): ReturnType<TodoState["getAll"]> {
		return this.state.getAll();
	}

	isLocked(): boolean {
		return this.state.isLocked();
	}

	getLockSource(): TodoLockSource | null {
		return this.state.getLockSource();
	}

	createMany(contents: string[]) {
		return this.state.createMany(contents);
	}

	update(id: number, status: "pending" | "in_progress" | "done") {
		return this.state.update(id, status);
	}

	initializeTodoItems(contents: readonly string[], lockSource?: TodoLockSource): void {
		this.state.createMany([...contents]);
		if (lockSource) this.state.lock(lockSource);
	}

	readSceneTodoState(): { readonly locked: boolean; readonly itemCount: number } {
		return { locked: this.state.isLocked(), itemCount: this.state.getAll().length };
	}

	initializeSceneTodoItems(contents: readonly string[]): void {
		this.state.clear();
		this.state.createMany([...contents]);
		this.state.lock("scene");
	}

	readItems(): ReturnType<RuntimeSessionTodoController["readItems"]> {
		return this.state.getAll().map((item) => ({ ...item }));
	}

	clear(): boolean {
		if (this.state.isLocked() || this.state.getAll().length === 0) return false;
		this.state.clear();
		return true;
	}

	initialize(document: ConversationDocument, context: GreenfieldRuntimeDocumentParticipantContext): void {
		if (this.documentContext) {
			throw new Error("Coding Agent Todo Runtime is already initialized");
		}
		this.documentContext = context;
		const snapshot = latestTodoSnapshot(document);
		if (snapshot) this.restore(snapshot);
		this.unsubscribe = this.state.subscribe(() => {
			if (!this.restoring) this.captureSnapshot();
		});
		if (!snapshot && (this.state.getAll().length > 0 || this.state.isLocked())) {
			this.captureSnapshot();
		}
	}

	onDocumentChanged(document: ConversationDocument): void {
		const snapshot = latestTodoSnapshot(document);
		this.restore(snapshot ?? []);
	}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started") {
			this.activeTurn = true;
			return;
		}
		if (event.type === "message.appended" && event.message.role === "toolResult") {
			this.schedulePendingSnapshots();
			await this.latestPersistence;
			return;
		}
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
			this.activeTurn = false;
			this.schedulePendingSnapshots();
			await this.latestPersistence;
		}
	}

	async flush(): Promise<void> {
		if (!this.activeTurn) this.schedulePendingSnapshots();
		await this.latestPersistence;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.activeTurn = false;
		await this.flush();
	}

	private captureSnapshot(): void {
		this.pendingSnapshots.push({
			items: this.state.getAll().map((item) => ({ ...item })),
			lockedBy: this.state.getLockSource(),
		});
		if (!this.activeTurn) this.schedulePendingSnapshots();
	}

	private schedulePendingSnapshots(): void {
		const context = this.documentContext;
		if (!context) return;
		for (const snapshot of this.pendingSnapshots.splice(0)) {
			const operation = this.persistenceTail.then(() =>
				context.appendCustomEntry({
					entryId: this.createEntryId(),
					customType: TODO_SNAPSHOT_TYPE,
					data: snapshot,
					timestamp: new Date(this.now()).toISOString(),
				}),
			);
			this.latestPersistence = operation;
			this.persistenceTail = operation.catch(() => undefined);
		}
	}

	private restore(snapshot: TodoSnapshot): void {
		this.restoring = true;
		try {
			this.state.restoreFromSnapshot(snapshot);
		} finally {
			this.restoring = false;
		}
	}
}

export function createCodingAgentTodoRuntimeToolRegistration(
	runtime: CodingAgentTodoRuntimePort,
): CodingToolRegistration<TodoToolInput> {
	const registration = createTodoToolRegistration({
		getTodoStore: () => runtime,
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.todo,
	});
	return {
		...registration,
		tool: {
			...registration.tool,
			async execute(request) {
				const result = await registration.tool.execute(request);
				await runtime.flush();
				return result;
			},
		},
	};
}

export function createCodingAgentTodoRuntimeFeature(
	registration: CodingToolRegistration<TodoToolInput>,
): AgentFeatureDefinition {
	return {
		id: "coding-agent.todo",
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { tools: [registration.tool] };
				},
				async dispose() {},
			};
		},
	};
}

function latestTodoSnapshot(document: ConversationDocument): TodoSnapshot | undefined {
	for (const entry of [...selectConversationDocumentEntries(document)].reverse()) {
		if (entry.type !== "custom" || entry.customType !== TODO_SNAPSHOT_TYPE) continue;
		return parseTodoSnapshot(entry.data, entry.id);
	}
	return undefined;
}
