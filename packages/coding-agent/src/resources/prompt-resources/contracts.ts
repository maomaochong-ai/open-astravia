import type { EcosystemHookContributionSource } from "@vetta/ecosystem-adapter";
import type { PromptResourceRef } from "@vetta/runtime-core";
import type { SessionResourceRuntime } from "../index.js";

export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

export interface PromptResourceExpansion {
	text: string;
	sceneInjection?: string;
	skillInjection?: string;
	skillHookContribution?: EcosystemHookContributionSource;
	promptRef?: PromptResourceRef;
}

export interface SceneTodoState {
	readSceneTodoState(): { readonly locked: boolean; readonly itemCount: number };
	initializeSceneTodoItems(contents: readonly string[]): void;
}

export interface PromptResourceExpansionDependencies {
	resourceLoader: Pick<SessionResourceRuntime, "getSkills">;
	todoState: SceneTodoState;
	emitError?: (error: { extensionPath: string; event: string; error: string }) => void;
}
