import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { CodingAgentRuntimeSessionControls } from "./contracts/index.js";
import type { GreenfieldSessionValueIndex } from "./greenfield-session-resource-index.js";
import type {
	GreenfieldSessionHookController,
	GreenfieldSessionResourceIndexes,
} from "./greenfield-session-resource-lifecycle-assembly.js";

type GreenfieldRuntimeSessionControlIndexes = Pick<
	GreenfieldSessionResourceIndexes,
	"executionRuntimes" | "hookSessionControllers" | "memoryControllers" | "resourceContexts"
>;

export interface GreenfieldRuntimeSessionControlsOptions {
	readonly indexes: GreenfieldRuntimeSessionControlIndexes;
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
export function createGreenfieldRuntimeSessionControls(
	options: GreenfieldRuntimeSessionControlsOptions,
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
			if (!context) throw new Error(`Greenfield session context not found: ${sessionId}`);
			context.contextAppender.append(records);
		},
		async deliverSessionContext(sessionId, records) {
			const context = options.indexes.resourceContexts.get(sessionId);
			if (!context) throw new Error(`Greenfield session context not found: ${sessionId}`);
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
	controllers: GreenfieldSessionValueIndex<GreenfieldSessionHookController>,
	sessionId: string,
): GreenfieldSessionHookController {
	const controller = controllers.get(sessionId);
	if (!controller) throw new Error(`Greenfield session hook lifecycle not found: ${sessionId}`);
	return controller;
}
