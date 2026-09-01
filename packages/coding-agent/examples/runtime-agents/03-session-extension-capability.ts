import { type Static, Type } from "@sinclair/typebox";
import { defineRuntimeAgent, type RuntimeAgentDefinition, RuntimeHost } from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	createDefaultRuntimeCapabilityDefinition,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
	defineSessionExtensionService,
	defineSessionExtensionSignal,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import { acquirePreview, executeTextTool } from "./support/preview.js";

const REVIEW_NOTES_EXTENSION_ID = "example.review-notes";
const AddReviewNoteInputSchema = Type.Object({ text: Type.String({ minLength: 1 }) }, { additionalProperties: false });
type AddReviewNoteInput = Static<typeof AddReviewNoteInputSchema>;

interface ReviewNotesRuntime {
	add(text: string): number;
	read(): readonly string[];
}

export const REVIEW_NOTES_RUNTIME = defineSessionExtensionService<ReviewNotesRuntime>(
	REVIEW_NOTES_EXTENSION_ID,
	"runtime",
);
export const REVIEW_NOTES_ADD = defineSessionExtensionEndpoint<AddReviewNoteInput, number>(
	REVIEW_NOTES_EXTENSION_ID,
	"add",
);
export const REVIEW_NOTES_READ = defineSessionExtensionEndpoint<void, readonly string[]>(
	REVIEW_NOTES_EXTENSION_ID,
	"read",
);
export const REVIEW_NOTES_CHANGED = defineSessionExtensionSignal<readonly string[]>(
	REVIEW_NOTES_EXTENSION_ID,
	"changed",
);
export const REVIEW_NOTES_OBSERVATION = defineSessionExtensionObservation<readonly string[]>(
	REVIEW_NOTES_EXTENSION_ID,
	"changed",
);

export interface SessionExtensionCapabilityExampleResult {
	readonly availableTools: readonly string[];
	readonly notes: readonly string[];
	readonly signalSnapshots: readonly (readonly string[])[];
	readonly serviceCount: number;
	readonly initialObservationCount: number;
	readonly secondSessionNotes: readonly string[];
}

/** 一个 Extension 同时拥有状态、Tool Feature、Service、Endpoint、Signal 与迟订阅状态。 */
export function createReviewNotesExtension(): SessionExtensionDefinition {
	return {
		id: REVIEW_NOTES_EXTENSION_ID,
		create(context) {
			const notes: string[] = [];
			const runtime: ReviewNotesRuntime = {
				add(text) {
					const normalized = text.trim();
					if (!normalized) throw new Error("Review note must not be empty");
					notes.push(normalized);
					context.signals.publish(REVIEW_NOTES_CHANGED, [...notes]);
					return notes.length;
				},
				read: () => [...notes],
			};
			return {
				contributions: [
					{ kind: "service", token: REVIEW_NOTES_RUNTIME, value: runtime },
					{ kind: "endpoint", token: REVIEW_NOTES_ADD, handle: ({ text }) => runtime.add(text) },
					{ kind: "endpoint", token: REVIEW_NOTES_READ, handle: () => runtime.read() },
					{ kind: "agent-feature", feature: createReviewNotesFeature(runtime) },
					{
						kind: "initial-observation-source",
						source: {
							id: `${REVIEW_NOTES_EXTENSION_ID}.initial-state`,
							read: () => {
								const current = runtime.read();
								return current.length > 0
									? [sessionExtensionObservation(REVIEW_NOTES_OBSERVATION, current)]
									: [];
							},
						},
					},
				],
				dispose() {
					notes.length = 0;
				},
			};
		},
	};
}

export function createReviewAgentWithSessionExtension(): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: "extension-reviewer",
		createInstance: () => ({
			prepareSession: () => ({
				capabilities: createDefaultRuntimeCapabilityDefinition({
					instructions: [
						{
							id: "extension-reviewer.base",
							content: "Record concrete review findings as session notes.",
							priority: 0,
						},
					],
					toolPolicy: { authorize: async () => true },
				}),
				sessionExtensions: [createReviewNotesExtension()],
			}),
		}),
	});
}

export async function runSessionExtensionCapabilityExample(): Promise<SessionExtensionCapabilityExampleResult> {
	const host = new RuntimeHost();
	try {
		host.agents.registry.upsert({
			source: { id: "example", revision: "extension-1" },
			definition: createReviewAgentWithSessionExtension(),
		});
		const instance = await host.agents.createInstance({
			agentId: "extension-reviewer",
			instanceId: "extension-reviewer-instance",
		});
		const session = await instance.createSession({ sessionId: "extension-reviewer-session" });
		const secondSession = await instance.createSession({ sessionId: "extension-reviewer-session-2" });
		const signalSnapshots: (readonly string[])[] = [];
		const unsubscribe = session.extensions.signals.subscribe(REVIEW_NOTES_CHANGED, (notes) => {
			signalSnapshots.push([...notes]);
		});
		const preview = await acquirePreview(session, "extension-turn");
		try {
			const tool = preview.frame.tools.get("review_note");
			if (!tool) throw new Error("Expected review_note in the example frame");
			await executeTextTool(
				tool,
				{ text: "Tool schemas remain stable within the Turn." },
				session.id,
				"extension-turn",
			);
			await session.extensions.invoke(REVIEW_NOTES_ADD, { text: "Add a regression test." });
			const notes = await session.extensions.invoke(REVIEW_NOTES_READ, undefined);
			return {
				availableTools: [...preview.frame.tools.keys()],
				notes,
				signalSnapshots,
				serviceCount: session.extensions.services.require(REVIEW_NOTES_RUNTIME).read().length,
				initialObservationCount: session.extensions.readInitialObservations().length,
				secondSessionNotes: await secondSession.extensions.invoke(REVIEW_NOTES_READ, undefined),
			};
		} finally {
			unsubscribe();
			await preview.lease.release();
		}
	} finally {
		await host.close();
	}
}

function createReviewNotesFeature(runtime: ReviewNotesRuntime): AgentFeatureDefinition {
	const tool: RuntimeToolDefinition<AddReviewNoteInput> = {
		name: "review_note",
		label: "Review note",
		description: "Record a concrete finding in the current review Session",
		inputSchema: AddReviewNoteInputSchema,
		async execute({ input, signal }) {
			signal.throwIfAborted();
			const count = runtime.add(input.text);
			return { content: [{ type: "text", text: `Recorded review note ${count}` }] };
		},
	};
	return {
		id: "example.review-notes.feature",
		async prepare() {
			return {
				async contribute() {
					return {
						instructions: [
							{
								id: "review-notes.guidance",
								content: "Use review_note for findings that must survive later model calls.",
								priority: 100,
							},
						],
						tools: [tool],
					};
				},
				async dispose() {},
			};
		},
	};
}
