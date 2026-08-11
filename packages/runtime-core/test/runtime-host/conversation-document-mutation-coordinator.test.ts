import { describe, expect, it } from "vitest";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentForkResult,
	type ConversationDocumentStore,
	createEmptyConversationDocument,
} from "../../src/conversation/index.js";
import type { StoredSessionEvent } from "../../src/kernel/contracts.js";
import { ConversationDocumentMutationCoordinator } from "../../src/runtime-host/conversation-document-mutation-coordinator.js";

const SESSION_ID = "coordinated-session";

describe("ConversationDocumentMutationCoordinator", () => {
	it("reloads the authoritative document before replaying a command that loses a Journal race", async () => {
		const store = new ControlledDocumentStore();
		let projected = createDocument();
		const event = messageEvent();
		store.beforeNextExecute = () => store.appendEvent(event);
		const coordinator = new ConversationDocumentMutationCoordinator({
			readSessionId: () => SESSION_ID,
			store,
			readProjectedDocument: () => projected,
			replaceProjectedDocument: (document) => {
				projected = document;
			},
		});

		await coordinator.execute(customEntryCommand("subagent-state"));

		expect(store.executeCalls).toBe(2);
		expect(store.expectedRevisions).toEqual([0, 1]);
		expect(store.document.entries.map(({ type }) => type)).toEqual(["message", "custom"]);
		expect(projected).toEqual(store.document);
	});

	it("refreshes a lagging projection from the store instead of replaying a persisted event locally", async () => {
		const store = new ControlledDocumentStore();
		let projected = createDocument();
		store.appendEvent(messageEvent());
		const coordinator = new ConversationDocumentMutationCoordinator({
			readSessionId: () => SESSION_ID,
			store,
			readProjectedDocument: () => projected,
			replaceProjectedDocument: (document) => {
				projected = document;
			},
		});

		await coordinator.synchronizeProjection();

		expect(projected).toEqual(store.document);
		expect(projected.journalVersion).toBe(1);
		expect(projected.revision).toBe(1);
	});

	it("serializes concurrent direct commands without regressing the projection", async () => {
		const store = new ControlledDocumentStore();
		let projected = createDocument();
		const coordinator = new ConversationDocumentMutationCoordinator({
			readSessionId: () => SESSION_ID,
			store,
			readProjectedDocument: () => projected,
			replaceProjectedDocument: (document) => {
				projected = document;
			},
		});

		await Promise.all([
			coordinator.execute(customEntryCommand("first")),
			coordinator.execute(customEntryCommand("second")),
		]);

		expect(store.expectedRevisions).toEqual([0, 1]);
		expect(store.document.revision).toBe(2);
		expect(projected).toEqual(store.document);
		expect(store.document.entries.map(({ id }) => id)).toEqual(["first", "second"]);
	});
});

class ControlledDocumentStore implements ConversationDocumentStore {
	document = createDocument();
	executeCalls = 0;
	expectedRevisions: number[] = [];
	beforeNextExecute: (() => void) | undefined;

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		if (sessionId !== SESSION_ID) throw new Error(`Unexpected Session: ${sessionId}`);
		return this.document;
	}

	async execute(
		sessionId: string,
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		if (sessionId !== SESSION_ID) throw new Error(`Unexpected Session: ${sessionId}`);
		this.executeCalls += 1;
		this.expectedRevisions.push(expectedRevision ?? -1);
		const beforeExecute = this.beforeNextExecute;
		this.beforeNextExecute = undefined;
		beforeExecute?.();
		if (expectedRevision !== null && this.document.revision !== expectedRevision) {
			throw new Error(`Document is at revision ${this.document.revision}, expected ${expectedRevision}`);
		}
		const result = applyConversationDocumentCommand(this.document, command);
		this.document = result.document;
		return result;
	}

	async fork(_sessionId: string, _entryId: string): Promise<ConversationDocumentForkResult> {
		throw new Error("Not implemented");
	}

	appendEvent(event: StoredSessionEvent): void {
		this.document = applyStoredEventToConversationDocument(this.document, event, this.document.journalVersion + 1);
	}
}

function createDocument(): ConversationDocument {
	return createEmptyConversationDocument({ sessionId: SESSION_ID, createdAt: 1 });
}

function customEntryCommand(entryId: string): ConversationDocumentCommand {
	return {
		type: "custom.append",
		entryId,
		customType: "subagent_state_v1",
		data: { entryId },
		timestamp: "2026-08-02T00:00:00.000Z",
	};
}

function messageEvent(): StoredSessionEvent {
	return {
		type: "message.appended",
		sessionId: SESSION_ID,
		turnId: "turn-1",
		message: {
			role: "user",
			content: [{ type: "text", text: "journal message" }],
			timestamp: 1,
		},
		timestamp: 1,
	};
}
