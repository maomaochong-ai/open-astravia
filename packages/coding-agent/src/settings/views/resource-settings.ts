import type { ResourceSettingsPort } from "../contracts/resource-settings.js";
import type { SettingsStatePort } from "../runtime/settings-state.js";

export function createResourceSettingsView(state: SettingsStatePort): ResourceSettingsPort {
	return {
		getTheme: () => state.read().theme,
		setTheme: (theme) => state.patchGlobal({ theme }),
		getPackages: () => [...(state.read().packages ?? [])],
		setPackages: (packages) => state.patchGlobal({ packages }),
		setProjectPackages: (packages) => state.patchProject({ packages }),
		getExtensionPaths: () => [...(state.read().extensions ?? [])],
		setExtensionPaths: (extensions) => state.patchGlobal({ extensions }),
		setProjectExtensionPaths: (extensions) => state.patchProject({ extensions }),
		getSkillPaths: () => [...(state.read().skills ?? [])],
		setSkillPaths: (skills) => state.patchGlobal({ skills }),
		setProjectSkillPaths: (skills) => state.patchProject({ skills }),
		getPromptTemplatePaths: () => [...(state.read().prompts ?? [])],
		setPromptTemplatePaths: (prompts) => state.patchGlobal({ prompts }),
		setProjectPromptTemplatePaths: (prompts) => state.patchProject({ prompts }),
		getThemePaths: () => [...(state.read().themes ?? [])],
		setThemePaths: (themes) => state.patchGlobal({ themes }),
		setProjectThemePaths: (themes) => state.patchProject({ themes }),
		getEnableSkillCommands: () => state.read().enableSkillCommands ?? true,
		setEnableSkillCommands: (enableSkillCommands) => state.patchGlobal({ enableSkillCommands }),
	};
}
