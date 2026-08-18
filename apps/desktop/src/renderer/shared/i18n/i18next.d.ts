// react-i18next 类型增强：基于 zh 资源给 t() / useTranslation 提供 key 自动补全与校验。
import "i18next";
import type abilities from "@/shared/i18n/locales/zh/abilities.json";
import type automation from "@/shared/i18n/locales/zh/automation.json";
import type batchTasks from "@/shared/i18n/locales/zh/batch-tasks.json";
import type chat from "@/shared/i18n/locales/zh/chat.json";
import type common from "@/shared/i18n/locales/zh/common.json";
import type main from "@/shared/i18n/locales/zh/main.json";
import type message from "@/shared/i18n/locales/zh/message.json";
import type pet from "@/shared/i18n/locales/zh/pet.json";
import type project from "@/shared/i18n/locales/zh/project.json";
import type settings from "@/shared/i18n/locales/zh/settings.json";
import type skills from "@/shared/i18n/locales/zh/skills.json";

declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "common";
		resources: {
			common: typeof common;
			main: typeof main;
			message: typeof message;
			chat: typeof chat;
			project: typeof project;
			pet: typeof pet;
			settings: typeof settings;
			skills: typeof skills;
			abilities: typeof abilities;
			"batch-tasks": typeof batchTasks;
			automation: typeof automation;
		};
	}
}
