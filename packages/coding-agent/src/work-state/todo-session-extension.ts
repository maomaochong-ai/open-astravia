import type { RuntimeDocumentParticipant } from "@vetta/runtime-core";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionService,
	defineSessionExtensionSignal,
	type SessionExtensionDefinition,
} from "@vetta/runtime-core/session-extensions";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools";
import type { CodingAgentRuntimeToolRegistration } from "../runtime-contracts/index.js";
import type { CodingAgentTodoRuntime, TodoItem, TodoLockSource } from "./contracts.js";
import { CodingAgentTodoContinuationSource } from "./todo-continuation-source.js";
import { CodingAgentTodoRuntime as DefaultCodingAgentTodoRuntime } from "./todo-runtime.js";
import {
	createCodingAgentTodoRuntimeFeature,
	createCodingAgentTodoRuntimeToolRegistration,
} from "./todo-tool-feature.js";

export const CODING_AGENT_TODO_EXTENSION_ID = "coding-agent.todo";

export interface CodingAgentTodoExtensionRuntime {
	readonly runtime: CodingAgentTodoRuntime;
	readonly toolRegistration: CodingAgentRuntimeToolRegistration;
	readonly toolEnabled: boolean;
}

export const CODING_AGENT_TODO_RUNTIME = defineSessionExtensionService<CodingAgentTodoExtensionRuntime>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"runtime",
);

export const CODING_AGENT_TODO_READ = defineSessionExtensionEndpoint<void, readonly TodoItem[]>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"read",
);

export const CODING_AGENT_TODO_CLEAR = defineSessionExtensionEndpoint<void, boolean>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"clear",
);

export const CODING_AGENT_TODO_CHANGED = defineSessionExtensionSignal<readonly TodoItem[]>(
	CODING_AGENT_TODO_EXTENSION_ID,
	"changed",
);

export interface CodingAgentTodoSessionExtensionOptions {
	readonly activation: CodingToolActivation;
	readonly createRuntime?: () => CodingAgentTodoRuntime;
	readonly initialItems?: readonly string[];
	readonly initialLockSource?: TodoLockSource;
	readonly reportUpdate?: (items: readonly TodoItem[]) => void | Promise<void>;
}

/** Todo 的 Session 生命周期与跨能力贡献入口。 */
export function createCodingAgentTodoSessionExtension(
	options: CodingAgentTodoSessionExtensionOptions,
): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_TODO_EXTENSION_ID,
		async create(context) {
			const runtime =
				options.createRuntime?.() ??
				new DefaultCodingAgentTodoRuntime({
					createEntryId: context.createId,
					now: () => context.clock.now(),
				});
			let unsubscribe: (() => void) | undefined;
			try {
				const toolRegistration = createCodingAgentTodoRuntimeToolRegistration(runtime);
				const toolEnabled = selectCodingToolRegistrations([toolRegistration], options.activation).length > 0;
				unsubscribe = runtime.subscribe((items) => {
					const snapshot = items.map((item) => ({ ...item }));
					context.signals.publish(CODING_AGENT_TODO_CHANGED, snapshot);
					void Promise.resolve(options.reportUpdate?.(snapshot)).catch((error: unknown) => {
						console.warn("[coding-agent-runtime] failed to publish todo observation", error);
					});
				});
				if (options.initialItems && options.initialItems.length > 0) {
					runtime.initializeTodoItems(options.initialItems, options.initialLockSource);
				}
				const continuationSource = new CodingAgentTodoContinuationSource({ state: runtime });
				const runtimeService: CodingAgentTodoExtensionRuntime = {
					runtime,
					toolRegistration,
					toolEnabled,
				};
				return {
					contributions: [
						{ kind: "service", token: CODING_AGENT_TODO_RUNTIME, value: runtimeService },
						{ kind: "endpoint", token: CODING_AGENT_TODO_READ, handle: () => runtime.readItems() },
						{ kind: "endpoint", token: CODING_AGENT_TODO_CLEAR, handle: () => runtime.clear() },
						{ kind: "document-participant", participant: withoutDisposal(runtime) },
						{
							kind: "continuation-source",
							source: {
								id: "todo",
								priority: 100,
								collect: (continuationContext) => continuationSource.collect(continuationContext),
							},
						},
						...(toolEnabled
							? [
									{
										kind: "agent-feature" as const,
										feature: createCodingAgentTodoRuntimeFeature(toolRegistration),
									},
								]
							: []),
					],
					async dispose() {
						unsubscribe?.();
						unsubscribe = undefined;
						await runtime.dispose();
					},
				};
			} catch (error) {
				unsubscribe?.();
				await runtime.dispose();
				throw error;
			}
		},
	};
}

function withoutDisposal(runtime: CodingAgentTodoRuntime): RuntimeDocumentParticipant {
	const onSessionEvent = runtime.onSessionEvent?.bind(runtime);
	return {
		initialize: (document, context) => runtime.initialize(document, context),
		onDocumentChanged: (document) => runtime.onDocumentChanged(document),
		...(onSessionEvent ? { onSessionEvent } : {}),
	};
}
