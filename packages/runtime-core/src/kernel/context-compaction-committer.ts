import type { ConversationDocument, ConversationDocumentReader } from "../conversation/document.js";
import type {
	Clock,
	ContextCompactionRecord,
	ConversationRepository,
	EventSink,
	KernelEvent,
	RuntimeSnapshot,
	StoredSessionEvent,
} from "./contracts.js";

export interface ContextCompactionCommitInput {
	readonly sessionId: string;
	readonly turnId?: string;
	readonly expectedVersion: number;
	readonly record: ContextCompactionRecord;
	readonly snapshot?: RuntimeSnapshot;
	readonly signal: AbortSignal;
}

export interface ContextCompactionCommitOutput {
	readonly version: number;
	readonly document?: ConversationDocument;
}

export interface ContextCompactionCommitterOptions {
	readonly repository: ConversationRepository;
	readonly eventSink: EventSink;
	readonly clock: Clock;
	readonly conversationDocumentReader?: ConversationDocumentReader;
}

/** 自动与手动压缩共享的唯一持久提交边界。 */
export class ContextCompactionCommitter {
	private readonly repository: ConversationRepository;
	private readonly eventSink: EventSink;
	private readonly clock: Clock;
	private readonly conversationDocumentReader: ConversationDocumentReader | undefined;

	constructor(options: ContextCompactionCommitterOptions) {
		this.repository = options.repository;
		this.eventSink = options.eventSink;
		this.clock = options.clock;
		this.conversationDocumentReader = options.conversationDocumentReader;
	}

	async commit(input: ContextCompactionCommitInput): Promise<ContextCompactionCommitOutput> {
		input.signal.throwIfAborted();
		const event: StoredSessionEvent = {
			type: "context.compacted",
			sessionId: input.sessionId,
			...(input.turnId === undefined ? {} : { turnId: input.turnId }),
			record: input.record,
			timestamp: this.clock.now(),
		};
		const result = await this.repository.append(input.sessionId, input.expectedVersion, [event]);
		await this.publishSafely(event);
		await this.notifyObserversSafely(input.snapshot, event, input.signal);
		return {
			version: result.version,
			document: await this.conversationDocumentReader?.readDocument(input.sessionId),
		};
	}

	private async notifyObserversSafely(
		snapshot: RuntimeSnapshot | undefined,
		event: StoredSessionEvent,
		signal: AbortSignal,
	): Promise<void> {
		if (!snapshot) return;
		for (const observer of snapshot.observers) {
			try {
				await observer.observe(event, signal);
			} catch (error) {
				await this.publishSafely({
					type: "observer.failed",
					sessionId: event.sessionId,
					...(event.turnId === undefined ? {} : { turnId: event.turnId }),
					observerId: observer.id,
					error: error instanceof Error ? error.message : String(error),
					timestamp: this.clock.now(),
				});
			}
		}
	}

	private async publishSafely(event: KernelEvent): Promise<void> {
		try {
			await this.eventSink.publish(event);
		} catch {
			// Event sinks are observational and cannot change persisted compaction semantics.
		}
	}
}
