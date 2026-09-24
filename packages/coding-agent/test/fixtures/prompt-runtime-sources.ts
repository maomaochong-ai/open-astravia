import type { CodingAgentPromptRuntimeSources } from "../../src/composition/contracts/index.js";

/** Host boundary for knowledge processing tests; the session and prompt runtime stay real. */
export async function createTestPromptRuntimeSources(): Promise<CodingAgentPromptRuntimeSources> {
	return {
		resourceSource: {
			getSystemPrompt: () => "Base prompt",
			getAppendSystemPrompt: () => [],
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSkills: () => ({ skills: [], diagnostics: [] }),
			refreshContextResourcesIfChanged: async () => false,
			refreshSkillsIfChanged: async () => false,
			setRuntimeSkillPaths: async () => {},
		},
		settingsSource: {
			getPersonalization: () => ({ personaId: "default", customPrompt: "" }),
			reloadPersonalizationSettings() {},
		},
	};
}
