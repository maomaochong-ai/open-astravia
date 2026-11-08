import type { EcosystemHookContributionSource } from "@astravia/ecosystem-adapter";
import type { PromptResourceRef } from "@astravia/runtime-core";
import type { SessionResourceRuntime } from "../index.js";

export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

export interface PromptResourceExpansion {
	text: string;
	skillInjection?: string;
	promptResourceHookContribution?: EcosystemHookContributionSource;
	/** 多技能展开时按请求顺序收集的 hook 贡献。 */
	promptResourceHookContributions?: readonly EcosystemHookContributionSource[];
	/** @deprecated Use promptResourceHookContribution. */
	skillHookContribution?: EcosystemHookContributionSource;
	promptRef?: PromptResourceRef;
}

export interface PromptResourceExpansionDependencies {
	resourceLoader: Pick<SessionResourceRuntime, "getSkills">;
	emitError?: (error: { extensionPath: string; event: string; error: string }) => void;
}
