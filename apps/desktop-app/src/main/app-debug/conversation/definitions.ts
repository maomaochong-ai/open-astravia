import type { SessionHistoryInfo } from "@vetta/runtime-core";
import {
	DesktopConversationError,
	type DesktopConversationService,
} from "../../conversations/desktop-conversation-service.js";
import { isConversationCwd } from "../../conversations/session-paths.js";
import type { DebugDefinition, JsonValue } from "../types.js";
import { DebugError } from "../types.js";
import { DebugConversationOperationCoordinator } from "./operation-coordinator.js";
import {
	abortConversationInputSchema,
	answerConversationInputSchema,
	continueConversationInputSchema,
	createConversationInputSchema,
	listConversationsInputSchema,
	waitConversationInputSchema,
} from "./schemas.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

function validateInput(
	schema: {
		safeParse: (
			input: unknown,
		) =>
			| { success: true; data: unknown }
			| { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
	},
	input: unknown,
): JsonValue {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw new DebugError("DEBUG_INVALID_INPUT", "Conversation debug input is invalid.", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.map(String).join("."),
				message: issue.message,
			})),
		});
	}
	return result.data as JsonValue;
}

function mapConversationError(error: unknown): never {
	if (!(error instanceof DesktopConversationError)) throw error;
	const details = error.details as JsonValue | undefined;
	switch (error.code) {
		case "INVALID_SESSION_PATH":
		case "SESSION_READ_ONLY":
			throw new DebugError("DEBUG_INVALID_INPUT", error.message, details);
		case "SESSION_NOT_FOUND":
			throw new DebugError("DEBUG_CONVERSATION_NOT_FOUND", error.message, details);
		case "SESSION_BUSY":
			throw new DebugError("DEBUG_SESSION_BUSY", error.message, details);
		case "SESSION_LOCKED":
			throw new DebugError("DEBUG_SESSION_LOCKED", error.message, details);
		case "TURN_TIMEOUT":
			throw new DebugError("DEBUG_CONVERSATION_TIMEOUT", error.message, details);
		case "TURN_ABORTED":
			throw new DebugError("DEBUG_CONVERSATION_ABORTED", error.message, details);
		case "TURN_FAILED":
			throw new DebugError("DEBUG_CONVERSATION_FAILED", error.message, details);
	}
}

function toSessionSummary(session: SessionHistoryInfo): JsonValue {
	return {
		id: session.id,
		sessionPath: session.path,
		cwd: session.cwd,
		name: session.name ?? "",
		firstMessage: session.firstMessage,
		modifiedAt: session.modifiedAt,
		lastMessagePreview: session.lastMessagePreview ?? "",
		parentSessionPath: session.parentSessionPath ?? "",
		parentEntryId: session.parentEntryId ?? "",
	};
}

export function createConversationDebugDefinitions(service: DesktopConversationService): DebugDefinition[] {
	const operations = new DebugConversationOperationCoordinator(service);
	return [
		{
			id: "conversation.list",
			category: "conversation",
			title: "List conversations",
			summary: "List persistent Vetta conversations for a project cwd.",
			keywords: ["conversation", "session", "history", "list"],
			inputSchema: { description: "Absolute cwd and optional result limit (1-200)." },
			examples: [{ description: "List recent project conversations", input: { cwd: "C:\\project", limit: 20 } }],
			validateInput: (input) => validateInput(listConversationsInputSchema, input),
			run: async (input) => {
				const request = listConversationsInputSchema.parse(input);
				try {
					const sessions = await service.listSessions(request.cwd);
					return sessions.slice(0, request.limit ?? 50).map(toSessionSummary);
				} catch (error) {
					return mapConversationError(error);
				}
			},
		},
		{
			id: "conversation.create",
			category: "conversation",
			title: "Create conversation",
			summary: "Create a persistent Vetta conversation and wait for its first agent turn.",
			keywords: ["conversation", "session", "create", "prompt", "agent"],
			inputSchema: {
				description:
					"Absolute cwd, non-empty prompt, optional structured promptRef ({ kind: skill|scene, name }) and attachments ({ kind: file|directory|image, path }), executionMode/modelKey/reasoning, and timeoutMs (1000-1800000).",
			},
			examples: [
				{
					description: "Create a sandboxed project conversation",
					input: { cwd: "C:\\project", prompt: "Inspect the current implementation and report problems." },
				},
			],
			validateInput: (input) => validateInput(createConversationInputSchema, input),
			run: async (input, context) => {
				const request = createConversationInputSchema.parse(input);
				try {
					const session = await service.createSession(
						{ cwd: request.cwd, executionMode: request.executionMode ?? "sandbox" },
						isConversationCwd(request.cwd) ? "conversation" : "other",
						"debug",
					);
					return await operations.start(
						session,
						{
							text: request.prompt,
							...(request.promptRef ? { promptRef: request.promptRef } : {}),
							...(request.attachments ? { attachments: request.attachments } : {}),
							...(request.modelKey ? { modelKey: request.modelKey } : {}),
							...(request.reasoning ? { reasoning: request.reasoning } : {}),
						},
						request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
						context.signal,
					);
				} catch (error) {
					return mapConversationError(error);
				}
			},
		},
		{
			id: "conversation.continue",
			category: "conversation",
			title: "Continue conversation",
			summary: "Open a persistent Vetta session by sessionPath and wait for another agent turn.",
			keywords: ["conversation", "session", "continue", "resume", "prompt", "agent"],
			inputSchema: {
				description:
					"Absolute sessionPath, non-empty prompt, optional structured promptRef ({ kind: skill|scene, name }) and attachments ({ kind: file|directory|image, path }), executionMode/modelKey/reasoning, and timeoutMs (1000-1800000).",
			},
			examples: [
				{
					description: "Continue a persistent conversation",
					input: {
						sessionPath: "C:\\project\\.vetta\\sessions\\session.jsonl",
						prompt: "Now run the verification.",
					},
				},
			],
			validateInput: (input) => validateInput(continueConversationInputSchema, input),
			run: async (input, context) => {
				const request = continueConversationInputSchema.parse(input);
				try {
					const session = await service.openSession(
						request.sessionPath,
						request.executionMode ?? "sandbox",
						"debug",
					);
					return await operations.start(
						session,
						{
							text: request.prompt,
							...(request.promptRef ? { promptRef: request.promptRef } : {}),
							...(request.attachments ? { attachments: request.attachments } : {}),
							...(request.modelKey ? { modelKey: request.modelKey } : {}),
							...(request.reasoning ? { reasoning: request.reasoning } : {}),
						},
						request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
						context.signal,
					);
				} catch (error) {
					return mapConversationError(error);
				}
			},
		},
		{
			id: "conversation.answer",
			category: "conversation",
			title: "Answer conversation question",
			summary: "Answer a pending ask_user_question interaction and wait for the next agent state.",
			keywords: ["conversation", "session", "answer", "question", "agent"],
			inputSchema: {
				description:
					"Operation id, interaction id, and one non-empty answer array for every question; or cancelled=true.",
			},
			examples: [
				{
					description: "Answer a pending single-choice question",
					input: {
						operationId: "00000000-0000-4000-8000-000000000001",
						interactionId: "00000000-0000-4000-8000-000000000002",
						answers: [{ question: "Which implementation should be used?", answers: ["Shared adapter"] }],
					},
				},
			],
			validateInput: (input) => validateInput(answerConversationInputSchema, input),
			run: async (input, context) => {
				const request = answerConversationInputSchema.parse(input);
				return await operations.answer(request, context.signal);
			},
		},
		{
			id: "conversation.wait",
			category: "conversation",
			title: "Wait for conversation",
			summary: "Wait for a running debug conversation to complete or request another answer.",
			keywords: ["conversation", "session", "wait", "status", "agent"],
			inputSchema: { description: "A conversation operation id returned by create or continue." },
			examples: [
				{
					description: "Wait for the next reportable state",
					input: { operationId: "00000000-0000-4000-8000-000000000001" },
				},
			],
			validateInput: (input) => validateInput(waitConversationInputSchema, input),
			run: async (input, context) => {
				const request = waitConversationInputSchema.parse(input);
				return await operations.wait(request.operationId, context.signal);
			},
		},
		{
			id: "conversation.abort",
			category: "conversation",
			title: "Abort conversation",
			summary: "Abort a running debug conversation operation, including a pending question.",
			keywords: ["conversation", "session", "abort", "cancel", "agent"],
			inputSchema: { description: "A conversation operation id returned by create or continue." },
			examples: [
				{
					description: "Abort an operation",
					input: { operationId: "00000000-0000-4000-8000-000000000001" },
				},
			],
			validateInput: (input) => validateInput(abortConversationInputSchema, input),
			run: async (input) => {
				const request = abortConversationInputSchema.parse(input);
				return await operations.abort(request.operationId);
			},
		},
	];
}
