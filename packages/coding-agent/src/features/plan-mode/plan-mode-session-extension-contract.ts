import { Value } from "@sinclair/typebox/value";
import type { SessionEvent } from "@vetta/runtime-core";
import {
	defineSessionExtensionEndpoint,
	defineSessionExtensionObservation,
} from "@vetta/runtime-core/session-extensions";
import {
	CODING_AGENT_PLAN_MODE_EXTENSION_ID,
	type CodingAgentPermissionMode,
	type CodingAgentPlanModeState,
} from "./contracts.js";
import { CodingAgentPlanModeStateSchema } from "./plan-mode-snapshot.js";

/** 宿主读取当前权限模式与最近一份计划。 */
export const CODING_AGENT_PLAN_MODE_STATE_READ = defineSessionExtensionEndpoint<void, CodingAgentPlanModeState>(
	CODING_AGENT_PLAN_MODE_EXTENSION_ID,
	"read",
);

/** 用户手势切换权限模式；模型自身只能经 `exit_plan_mode` 的审批放宽，不能调用这里。 */
export const CODING_AGENT_PERMISSION_MODE_SET = defineSessionExtensionEndpoint<
	{ readonly permissionMode: CodingAgentPermissionMode },
	CodingAgentPlanModeState
>(CODING_AGENT_PLAN_MODE_EXTENSION_ID, "set-permission-mode");

export const CODING_AGENT_PLAN_MODE_OBSERVATION = defineSessionExtensionObservation<CodingAgentPlanModeState>(
	CODING_AGENT_PLAN_MODE_EXTENSION_ID,
	"changed",
);

/** 在宿主协议边界识别并校验 Plan Mode 观察；其他扩展事件返回 undefined。 */
export function readCodingAgentPlanModeObservation(event: SessionEvent): CodingAgentPlanModeState | undefined {
	if (
		event.type !== "session.extension" ||
		event.extensionId !== CODING_AGENT_PLAN_MODE_OBSERVATION.extensionId ||
		event.event !== CODING_AGENT_PLAN_MODE_OBSERVATION.event ||
		!Value.Check(CodingAgentPlanModeStateSchema, event.payload)
	) {
		return undefined;
	}
	return event.payload.plan
		? { permissionMode: event.payload.permissionMode, plan: { ...event.payload.plan } }
		: { permissionMode: event.payload.permissionMode };
}
