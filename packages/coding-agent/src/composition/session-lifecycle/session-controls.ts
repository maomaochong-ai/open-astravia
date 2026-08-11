import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionControls } from "../contracts/index.js";
import type { CodingAgentSessionValueIndex } from "./indexes.js";
import type { CodingAgentSessionHookController, CodingAgentSessionResourceIndexes } from "./resource-lifecycle.js";

type CodingAgentRuntimeSessionControlIndexes = Pick<
	CodingAgentSessionResourceIndexes,
	"executionRuntimes" | "hookSessionControllers" | "memoryControllers" | "resourceContexts"
>;

export interface CodingAgentRuntimeSessionControlsOptions {
	readonly indexes: CodingAgentRuntimeSessionControlIndexes;
	readonly readConversationDocument: (sessionId: string) => Promise<ConversationDocument>;
	readonly projectConversationContext: (document: ConversationDocument) => readonly RuntimeMessageEnvelope[];
	readonly projectConversationSeed: (document: ConversationDocument) => readonly RuntimeMessageEnvelope[];
	readonly preserveConversationContext: (
		targetSessionId: string,
		source: readonly RuntimeMessageEnvelope[],
		targetSeed: readonly RuntimeMessageEnvelope[],
	) => void;
	readonly clearConversationContext: (sessionId: string) => void;
	readonly reloadMcp: (sessionId: string) => Promise<unknown>;
}

/** 将宿主的 Session 控制调用投影到实时 Composition 资源索引。 */
export function createCodingAgentRuntimeSessionControls(
	options: CodingAgentRuntimeSessionControlsOptions,
): CodingAgentRuntimeSessionControls {
	return {
		sessionHooks: {
			async end(sessionId, cause) {
				await requireSessionHookController(options.indexes.hookSessionControllers, sessionId).end(cause);
			},
			start(sessionId, source) {
				requireSessionHookController(options.indexes.hookSessionControllers, sessionId).start(source);
			},
			discard(sessionId) {
				requireSessionHookController(options.indexes.hookSessionControllers, sessionId).discard();
			},
		},
		appendSessionContext(sessionId, records) {
			const context = options.indexes.resourceContexts.get(sessionId);
			if (!context) throw new Error(`Session context not found: ${sessionId}`);
			context.contextAppender.append(records);
		},
		async deliverSessionContext(sessionId, records) {
			const context = options.indexes.resourceContexts.get(sessionId);
			if (!context) throw new Error(`Session context not found: ${sessionId}`);
			await context.deliverAsyncContext(records);
		},
		async quiesceSessionBackgroundCommands(sessionId) {
			await options.indexes.executionRuntimes.get(sessionId)?.quiesceBackgroundCommands();
		},
		async preserveSessionExecutionContext(sourceSessionId, targetSessionId) {
			const [sourceDocument, targetDocument] = await Promise.all([
				options.readConversationDocument(sourceSessionId),
				options.readConversationDocument(targetSessionId),
			]);
			options.preserveConversationContext(
				targetSessionId,
				options.projectConversationContext(sourceDocument),
				options.projectConversationSeed(targetDocument),
			);
		},
		clearSessionExecutionContext(sessionId) {
			options.clearConversationContext(sessionId);
		},
		async flushMemory(sessionId, signal) {
			return (await options.indexes.memoryControllers.get(sessionId)?.flushMemory(signal)) ?? 0;
		},
		async reloadMcp(sessionId) {
			await options.reloadMcp(sessionId);
		},
	};
}

function requireSessionHookController(
	controllers: CodingAgentSessionValueIndex<CodingAgentSessionHookController>,
	sessionId: string,
): CodingAgentSessionHookController {
	const controller = controllers.get(sessionId);
	if (!controller) throw new Error(`Session hook lifecycle not found: ${sessionId}`);
	return controller;
}
