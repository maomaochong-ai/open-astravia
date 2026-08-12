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
			const record = await this.options.contextRuntime.compactManual(input, controller.signal);
			controller.signal.throwIfAborted();
			const committed = await this.options.committer.commit({
				sessionId: this.options.session.id,
				expectedVersion: conversation.version,
				record,
				snapshot: lease.snapshot,
				signal: controller.signal,
			});
			await this.options.contextRuntime.onManualCompactionCommitted?.(
				record,
				input,
				controller.signal,
				committed.document,
			);
			return {
				summary: record.summary,
				firstKeptEntryId: record.firstKeptEntryId,
				tokensBefore: record.tokensBefore,
				...(record.details === undefined ? {} : { details: record.details }),
			};
		} finally {
			await lease?.release();
			if (this.activeController === controller) this.activeController = undefined;
		}
	}

	abortCompaction(): void {
		this.activeController?.abort("Manual context compaction aborted");
	}

	setAutoCompactionEnabled(enabled: boolean): void {
		this.options.contextRuntime.setAutoCompactionEnabled(enabled);
	}
}
