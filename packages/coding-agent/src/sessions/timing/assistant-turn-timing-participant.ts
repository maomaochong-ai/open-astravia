import type {
	ConversationDocument,
	RuntimeDocumentParticipant,
	RuntimeDocumentParticipantContext,
} from "@vetta/runtime-core";
import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";

export const ASSISTANT_TURN_TIMING_TYPE = "vetta.assistant_turn_timing";

/** Persists turn timing beside the assistant history it describes. */
export class AssistantTurnTimingParticipant implements RuntimeDocumentParticipant {
	readonly #startedAtByTurnId = new Map<string, number>();
	#context: RuntimeDocumentParticipantContext | undefined;

	initialize(_document: ConversationDocument, context: RuntimeDocumentParticipantContext): void {
		this.#context = context;
	}

	onDocumentChanged(): void {}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started") {
			this.#startedAtByTurnId.set(event.turnId, event.timestamp);
			return;
		}
		if (event.type === "turn.continued") {
			if (!this.#startedAtByTurnId.has(event.turnId)) {
				this.#startedAtByTurnId.set(event.turnId, event.timestamp);
			}
			return;
		}
		if (event.type !== "turn.completed" && event.type !== "turn.cancelled" && event.type !== "turn.failed") {
			return;
		}
		const startedAt = this.#startedAtByTurnId.get(event.turnId);
		if (startedAt === undefined) return;
		this.#startedAtByTurnId.delete(event.turnId);
		const context = this.#context;
		if (!context) return;
		await context.appendCustomEntry({
			entryId: `assistant-turn-timing:${event.turnId}`,
			customType: ASSISTANT_TURN_TIMING_TYPE,
			data: {
				startedAt,
				endedAt: event.timestamp,
				durationMs: Math.max(0, event.timestamp - startedAt),
			},
			timestamp: new Date(event.timestamp).toISOString(),
		});
	}

	dispose(): void {
		this.#startedAtByTurnId.clear();
		this.#context = undefined;
	}
}
