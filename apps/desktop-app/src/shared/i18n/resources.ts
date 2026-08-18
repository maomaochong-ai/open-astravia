// 静态打包的 catalog 聚合（见 ADR-0031）。main 与 renderer 都顶层 import 本文件，
// 由各自 Vite bundle 把 JSON 内联——零运行时 fs、零 async、不闪。新增语言/ns =
// 在此加一条 import + 在 resources 里加一项。

import enAbilities from "./locales/en/abilities.json";
import enAutomation from "./locales/en/automation.json";
import enBatchTasks from "./locales/en/batch-tasks.json";
import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enMain from "./locales/en/main.json";
import enMessage from "./locales/en/message.json";
import enPet from "./locales/en/pet.json";
import enProject from "./locales/en/project.json";
import enSettings from "./locales/en/settings.json";
import enSkills from "./locales/en/skills.json";
import zhAbilities from "./locales/zh/abilities.json";
import zhAutomation from "./locales/zh/automation.json";
import zhBatchTasks from "./locales/zh/batch-tasks.json";
import zhChat from "./locales/zh/chat.json";
import zhCommon from "./locales/zh/common.json";
import zhMain from "./locales/zh/main.json";
import zhMessage from "./locales/zh/message.json";
import zhPet from "./locales/zh/pet.json";
import zhProject from "./locales/zh/project.json";
import zhSettings from "./locales/zh/settings.json";
import zhSkills from "./locales/zh/skills.json";

export const resources = {
	zh: {
		common: zhCommon,
		main: zhMain,
		chat: zhChat,
		project: zhProject,
		pet: zhPet,
		settings: zhSettings,
		message: zhMessage,
		skills: zhSkills,
		abilities: zhAbilities,
		"batch-tasks": zhBatchTasks,
		automation: zhAutomation,
	},
	en: {
		common: enCommon,
		main: enMain,
		chat: enChat,
		project: enProject,
		pet: enPet,
		settings: enSettings,
		message: enMessage,
		skills: enSkills,
		abilities: enAbilities,
		"batch-tasks": enBatchTasks,
		automation: enAutomation,
	},
} as const;

export * from "./config.js";
