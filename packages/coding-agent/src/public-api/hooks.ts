export {
	aggregateHookDispatchOutcomes,
	type BuildDefaultHookConfigLayersOptions,
	buildDefaultHookConfigLayers,
	createEcosystemHookRuntime,
	type EcosystemHookAdapter,
	type EcosystemHookAdapterFactory,
	type EcosystemHookEvent,
	type EcosystemHookHost,
	EcosystemHookRuntime,
	emptyHookDispatchOutcome,
	HOOK_EVENT_NAMES,
	type HookConfigLayer,
	type HookDispatchEffect,
	type HookDispatchOutcome,
	type HookEventName,
	type HookOutputEntry,
	type HookRunSummary,
} from "@vetta/ecosystem-adapter";
export {
	type EcosystemHookAwareTool,
	wrapToolsWithEcosystemHooks,
} from "../extensions/runtime/ecosystem-hook-tool-wrapper.js";
