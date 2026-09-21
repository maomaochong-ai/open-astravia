import type { RuntimeDocumentParticipant } from "@vetta/runtime-core";
import {
	defineSessionExtensionService,
	optionalSessionExtensionFunction,
	type SessionExtensionDefinition,
	sessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import type { ConversationScenario } from "../../profiles/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import {
	CODING_AGENT_PLAN_MODE_EXTENSION_ID,
	CODING_AGENT_PLAN_REVIEW_FUNCTION,
	type CodingAgentPlanModeState,
	isCodingAgentPermissionMode,
} from "./contracts.js";
import { createCodingAgentPlanModeFeature } from "./plan-mode-feature.js";
import { CodingAgentPlanModeRuntime, type PlanModeTurnBinding } from "./plan-mode-runtime.js";
import {
	CODING_AGENT_PERMISSION_MODE_SET,
	CODING_AGENT_PLAN_MODE_OBSERVATION,
	CODING_AGENT_PLAN_MODE_STATE_READ,
} from "./plan-mode-session-extension-contract.js";
import { createExitPlanModeTool } from "./tool/index.js";

/** 其他产品能力（工具面闸门、执行闸门、Hook 宿主）读取权限状态的窄口。 */
export interface CodingAgentPlanModeExtensionRuntime {
	readPermissionMode(): CodingAgentPlanModeState["permissionMode"];
	bindForTurn(): PlanModeTurnBinding;
}

export const CODING_AGENT_PLAN_MODE_RUNTIME = defineSessionExtensionService<CodingAgentPlanModeExtensionRuntime>(
	CODING_AGENT_PLAN_MODE_EXTENSION_ID,
	"runtime",
);

export interface CodingAgentPlanModeSessionExtensionOptions {
	readonly scenario: ConversationScenario;
	readonly isTodoToolAvailable: () => boolean;
	readonly reportUpdate?: (state: CodingAgentPlanModeState) => void | Promise<void>;
}

/** Plan 模式的 Session 生命周期与跨能力贡献入口。 */
export function createCodingAgentPlanModeSessionExtension(
	options: CodingAgentPlanModeSessionExtensionOptions,
): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_PLAN_MODE_EXTENSION_ID,
		functionDependencies: [optionalSessionExtensionFunction(CODING_AGENT_PLAN_REVIEW_FUNCTION)],
		create(context) {
			const runtime = new CodingAgentPlanModeRuntime({
				createEntryId: context.createId,
				now: () => context.clock.now(),
			});
			const unsubscribe = runtime.subscribe((state) => {
				void Promise.resolve(options.reportUpdate?.(state)).catch((error: unknown) => {
					console.warn("[coding-agent-runtime] failed to publish plan mode observation", error);
				});
			});
			const exitTool = createExitPlanModeTool({
				store: runtime,
				review: ({ sessionId, plan }, signal) =>
					context.functions.invoke(
						CODING_AGENT_PLAN_REVIEW_FUNCTION,
						{ requestId: context.createId(), sessionId, plan },
						signal,
					),
				isTodoToolAvailable: options.isTodoToolAvailable,
				modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.exitPlanMode,
			});
			const service: CodingAgentPlanModeExtensionRuntime = {
				readPermissionMode: () => runtime.readPermissionMode(),
				bindForTurn: () => runtime.bindForTurn(),
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_PLAN_MODE_RUNTIME, value: service },
					{ kind: "endpoint", token: CODING_AGENT_PLAN_MODE_STATE_READ, handle: () => runtime.readState() },
					{
						kind: "endpoint",
						token: CODING_AGENT_PERMISSION_MODE_SET,
						handle: ({ permissionMode }) => {
							if (!isCodingAgentPermissionMode(permissionMode)) {
								throw new Error(`Unknown permission mode: ${String(permissionMode)}`);
							}
							if (permissionMode === "plan" && !supportsPlanMode(options.scenario)) {
								throw new Error(`Plan mode is unavailable in the ${options.scenario} scenario`);
							}
							runtime.setPermissionMode(permissionMode);
							return runtime.readState();
						},
					},
					{
						kind: "initial-observation-source",
						source: {
							id: `${CODING_AGENT_PLAN_MODE_EXTENSION_ID}.initial-state`,
							read: () => {
								const state = runtime.readState();
								return state.permissionMode === "plan" || state.plan
									? [sessionExtensionObservation(CODING_AGENT_PLAN_MODE_OBSERVATION, state)]
									: [];
							},
						},
					},
					{ kind: "document-participant", participant: withoutDisposal(runtime) },
					{
						kind: "agent-feature",
						feature: createCodingAgentPlanModeFeature({
							bindForTurn: () => runtime.bindForTurn(),
							canSubmitPlan: () => context.functions.has(CODING_AGENT_PLAN_REVIEW_FUNCTION),
							exitTool,
						}),
					},
				],
				async dispose() {
					unsubscribe();
					await runtime.dispose();
				},
			};
		},
	};
}

/**
 * Plan 模式需要一个能做决定的人：批量、自动化、IM 与知识库加工会话没有审批面，
 * 进入后只会永久卡在只读态，因此直接拒绝进入。
 */
function supportsPlanMode(scenario: ConversationScenario): boolean {
	return scenario === "conversation" || scenario === "project" || scenario === "cli";
}

function withoutDisposal(runtime: CodingAgentPlanModeRuntime): RuntimeDocumentParticipant {
	return {
		initialize: (document, context) => runtime.initialize(document, context),
		onDocumentChanged: (document) => runtime.onDocumentChanged(document),
		onSessionEvent: (event) => runtime.onSessionEvent(event),
	};
}
