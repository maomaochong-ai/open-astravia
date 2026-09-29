import type { RuntimeDocumentParticipant } from "@vetta/runtime-core";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import {
	defineSessionExtensionService,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentGoalSnapshot } from "./contracts.js";
import { CODING_AGENT_GOAL_EXTENSION_ID, isCodingAgentGoalStatus } from "./contracts.js";
import { CodingAgentGoalContinuationSource } from "./goal-continuation-source.js";
import { createCodingAgentGoalFeature } from "./goal-feature.js";
import { CodingAgentGoalRuntime } from "./goal-runtime.js";
import {
	CODING_AGENT_GOAL_CLEAR,
	CODING_AGENT_GOAL_CREATE,
	CODING_AGENT_GOAL_OBSERVATION,
	CODING_AGENT_GOAL_STATE_READ,
	CODING_AGENT_GOAL_UPDATE,
} from "./goal-session-extension-contract.js";

export const CODING_AGENT_GOAL_RUNTIME = defineSessionExtensionService<CodingAgentGoalRuntime>(
	CODING_AGENT_GOAL_EXTENSION_ID,
	"runtime",
);

export interface CodingAgentGoalSessionExtensionOptions {
	readonly scenario: ConversationScenario;
	readonly reportUpdate?: (state: CodingAgentGoalSnapshot) => void | Promise<void>;
}

export function createCodingAgentGoalSessionExtension(
	options: CodingAgentGoalSessionExtensionOptions,
): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_GOAL_EXTENSION_ID,
		create(context) {
			const runtime = new CodingAgentGoalRuntime({ createId: context.createId, now: () => context.clock.now() });
			const unsubscribe = runtime.subscribe((state) => {
				void Promise.resolve(options.reportUpdate?.(state)).catch((error: unknown) => {
					console.warn("[coding-agent-runtime] failed to publish goal observation", error);
				});
			});
			const supported = supportsGoalMode(options.scenario);
			const continuation = new CodingAgentGoalContinuationSource(runtime, () => context.clock.now());
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_GOAL_RUNTIME, value: runtime },
					{ kind: "endpoint", token: CODING_AGENT_GOAL_STATE_READ, handle: () => runtime.readState() },
					{
						kind: "endpoint",
						token: CODING_AGENT_GOAL_CREATE,
						handle: ({ objective }) => {
							if (!supported) throw new Error(`Goal mode is unavailable in the ${options.scenario} scenario`);
							return runtime.create(objective);
						},
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_GOAL_UPDATE,
						handle: ({ goalId, status, statusDetail }) => {
							if (!isCodingAgentGoalStatus(status)) throw new Error(`Unknown goal status: ${String(status)}`);
							return runtime.update(goalId, status, statusDetail);
						},
					},
					{
						kind: "endpoint",
						token: CODING_AGENT_GOAL_CLEAR,
						handle: ({ goalId }) => runtime.clear(goalId),
					},
					{
						kind: "initial-observation-source",
						source: {
							id: `${CODING_AGENT_GOAL_EXTENSION_ID}.initial-state`,
							read: () => {
								const state = runtime.readState();
								return state ? [sessionExtensionObservation(CODING_AGENT_GOAL_OBSERVATION, state)] : [];
							},
						},
					},
					{ kind: "document-participant", participant: withoutDisposal(runtime) },
					...(supported
						? [
								{ kind: "agent-feature" as const, feature: createCodingAgentGoalFeature(runtime) },
								{
									kind: "continuation-source" as const,
									source: {
										id: "goal",
										priority: 150,
										collect: (ctx: ContinuationPolicyContext) => continuation.collect(ctx),
									},
								},
							]
						: []),
				],
				async dispose() {
					unsubscribe();
					await runtime.dispose();
				},
			};
		},
	};
}

function supportsGoalMode(scenario: ConversationScenario): boolean {
	return scenario === "conversation" || scenario === "project" || scenario === "cli";
}

function withoutDisposal(runtime: CodingAgentGoalRuntime): RuntimeDocumentParticipant {
	return {
		initialize: (document, context) => runtime.initialize(document, context),
		onDocumentChanged: (document) => runtime.onDocumentChanged(document),
		onSessionEvent: (event) => runtime.onSessionEvent(event),
	};
}
