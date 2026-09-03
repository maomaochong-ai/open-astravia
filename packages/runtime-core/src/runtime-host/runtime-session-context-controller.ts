import type { ConversationDocumentReader } from "../conversation/document.js";
import type { AgentSession } from "../kernel/agent-session.js";
import type { ContextCompactionCommitter } from "../kernel/context-compaction-committer.js";
import type {
	ConversationRepository,
	ManualContextCompactionRuntime,
	RuntimeSnapshotProvider,
} from "../kernel/contracts.js";
import { sessionBusyError } from "../kernel/errors.js";
import type {
	RuntimeContextCompactionRequest,
	RuntimeContextCompactionResult,
	RuntimeContextCompactionState,
	RuntimeContextSummaryRequest,
	RuntimeContextSummaryResult,
	RuntimeSessionContextController,
} from "./session-ports.js";

export interface RuntimeSessionContextControllerOptions {
	readonly session: AgentSession;
	readonly repository: ConversationRepository;
	readonly conversationDocumentReader: ConversationDocumentReader;
	readonly snapshotProvider: RuntimeSnapshotProvider;
	readonly contextRuntime: ManualContextCompactionRuntime;
	readonly committer: ContextCompactionCommitter;
}

/** Runtime Session 的手动压缩、取消和自动压缩开关编排。 */
export class KernelRuntimeSessionContextController implements RuntimeSessionContextController {
	private readonly options: RuntimeSessionContextControllerOptions;
	private activeController: AbortController | undefined;

	constructor(options: RuntimeSessionContextControllerOptions) {
		this.options = options;
	}

	readState(): RuntimeContextCompactionState {
		return {
			isCompacting: this.activeController !== undefined,
			autoCompactionEnabled: this.options.contextRuntime.readAutoCompactionEnabled(),
		};
	}

	async compact(request: RuntimeContextCompactionRequest = {}): Promise<RuntimeContextCompactionResult> {
		if (this.activeController) throw sessionBusyError();
		const controller = new AbortController();
		this.activeController = controller;
		let lease: Awaited<ReturnType<RuntimeSnapshotProvider["acquire"]>> | undefined;
		try {
			await this.options.session.cancel("Manual context compaction");
			controller.signal.throwIfAborted();
			lease = await this.options.snapshotProvider.acquire({
				sessionId: this.options.session.id,
				operationId: `${this.options.session.id}:manual-compaction`,
				reason: "manual_compaction",
				signal: controller.signal,
			});
			const [conversation, document] = await Promise.all([
				this.options.repository.load(this.options.session.id),
				this.options.conversationDocumentReader.readDocument(this.options.session.id),
			]);
			const input = {
				sessionId: this.options.session.id,
				document,
				modelBinding: lease.modelBinding,
				customInstructions: request.customInstructions,
			};
			// Static legacy capabilities need no lease. Dynamic owners must be part of this snapshot.
			const strategy =
				lease.snapshot.manualCompactionStrategy ??
				(this.options.contextRuntime.bindForTurn ? undefined : this.options.contextRuntime);
			if (!strategy) throw new Error("Manual compaction strategy is not registered in the Runtime Snapshot");
			const record = await strategy.compactManual(input, controller.signal);
			controller.signal.throwIfAborted();
			const committed = await this.options.committer.commit({
				sessionId: this.options.session.id,
				expectedVersion: conversation.version,
				record,
				snapshot: lease.snapshot,
				signal: controller.signal,
			});
			await strategy.onManualCompactionCommitted?.(record, input, controller.signal, committed.document);
			return {
				summary: record.summary,
				firstKeptEntryId: record.firstKeptEntryId,
				tokensBefore: record.tokensBefore,
				...(record.details === undefined ? {} : { details: record.details }),
			};
		} finally {
			try {
				await lease?.release();
			} finally {
				if (this.activeController === controller) this.activeController = undefined;
			}
		}
	}

	async summarize(request: RuntimeContextSummaryRequest): Promise<RuntimeContextSummaryResult> {
		if (this.activeController) throw sessionBusyError();
		const controller = new AbortController();
		const abortFromRequest = () => controller.abort(request.signal?.reason);
		request.signal?.addEventListener("abort", abortFromRequest, { once: true });
		if (request.signal?.aborted) abortFromRequest();
		this.activeController = controller;
		let lease: Awaited<ReturnType<RuntimeSnapshotProvider["acquire"]>> | undefined;
		try {
			controller.signal.throwIfAborted();
			const records = freezeContextSummaryValue(structuredClone(request.records));
			lease = await this.options.snapshotProvider.acquire({
				sessionId: this.options.session.id,
				operationId: `${this.options.session.id}:context-summary`,
				reason: "context_summary",
				signal: controller.signal,
			});
			const strategy = lease.snapshot.contextSummaryStrategy;
			if (!strategy) throw new Error("Context summary strategy is not registered in the Runtime Snapshot");
			const result = await strategy.summarizeContext(
				{
					sessionId: this.options.session.id,
					records,
					modelBinding: lease.modelBinding,
					...(request.previousSummary === undefined ? {} : { previousSummary: request.previousSummary }),
					...(request.customInstructions === undefined ? {} : { customInstructions: request.customInstructions }),
				},
				controller.signal,
			);
			controller.signal.throwIfAborted();
			return result;
		} finally {
			try {
				await lease?.release();
			} finally {
				request.signal?.removeEventListener("abort", abortFromRequest);
				if (this.activeController === controller) this.activeController = undefined;
			}
		}
	}

	abortCompaction(): void {
		this.activeController?.abort("Context generation aborted");
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.options.contextRuntime.setAutoCompactionEnabled(enabled);
	}
}

function freezeContextSummaryValue<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) freezeContextSummaryValue(nested);
		Object.freeze(value);
	}
	return value;
}
