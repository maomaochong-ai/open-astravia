import type { EcosystemHookContributionSource } from "@vetta/ecosystem-adapter";
import type { PromptResourceRef, RuntimePromptPreparationContext } from "@vetta/runtime-core";
import type { ModelCallFrameCompositionContext } from "@vetta/runtime-core/kernel";
import type { BuildSystemPromptOptions, PersonalizationSettingsSource } from "../model-context/index.js";
import type { SessionResourceRuntime } from "../resources/index.js";

export interface CodingAgentPromptResourceExpansion {
	readonly text: string;
	readonly promptRef?: PromptResourceRef;
	readonly skillInjection?: string;
	readonly skillHookContribution?: EcosystemHookContributionSource;
	readonly sceneInjection?: string;
}

export type CodingAgentPromptResourceResolver = (
	text: string,
	promptRef: PromptResourceRef,
	context: RuntimePromptPreparationContext,
) => Promise<CodingAgentPromptResourceExpansion> | CodingAgentPromptResourceExpansion;

export type CodingAgentPromptResourceSource = Pick<
	SessionResourceRuntime,
	| "getAgentsFiles"
	| "getAppendSystemPrompt"
	| "getSkills"
	| "getSystemPrompt"
	| "refreshContextResourcesIfChanged"
	| "refreshSkillsIfChanged"
	| "setRuntimeSkillPaths"
>;

export interface CodingAgentPromptSettingsSource extends PersonalizationSettingsSource {
	reloadPersonalizationSettings(): void;
	reloadImageSettings?(): void;
	getBlockImages?(): boolean;
}

export interface CodingAgentModelCallPromptContext extends ModelCallFrameCompositionContext {
	readonly activeToolNames: readonly string[];
}

export type CodingAgentSystemPromptOptionsResolver = (
	context: CodingAgentModelCallPromptContext,
) => Promise<Omit<BuildSystemPromptOptions, "selectedTools">> | Omit<BuildSystemPromptOptions, "selectedTools">;
