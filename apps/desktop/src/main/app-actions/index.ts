import { AppActionCatalog } from "./catalog.js";
import { AppActionRuntime } from "./runtime.js";
import type { ActionApprovalRequester } from "./types.js";

export interface AppActionSystem {
	catalog: AppActionCatalog;
	runtime: AppActionRuntime;
}

const REQUIRED_ACTION_PROVIDER_PREFIXES = ["plugin:vetta-actions:"] as const;

/**
 * 创建空的 App Action 运行时。
 * 具体 Action 由官方/第三方插件经 PluginActionService 动态注册；
 * 每个 action id 仅保留先注册的实现，冲突只记日志。
 */
export function createAppActionSystem(approvalRequester: ActionApprovalRequester): AppActionSystem {
	const catalog = new AppActionCatalog({ requiredProviderPrefixes: REQUIRED_ACTION_PROVIDER_PREFIXES });
	return {
		catalog,
		runtime: new AppActionRuntime(catalog, approvalRequester),
	};
}

export function createAppActionRuntime(approvalRequester: ActionApprovalRequester): AppActionRuntime {
	return createAppActionSystem(approvalRequester).runtime;
}

export { AppActionRuntime } from "./runtime.js";
export type {
	ActionApprovalMetadata,
	ActionApprovalPresentation,
	ActionApprovalRequest,
	ActionApprovalRequester,
	ActionContext,
	ActionDefinition,
	ActionErrorBody,
	ActionMetadata,
	ActionSearchResult,
	JsonValue,
} from "./types.js";
export { ActionError } from "./types.js";
