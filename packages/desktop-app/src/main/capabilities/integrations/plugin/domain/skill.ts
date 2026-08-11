import {
	DOMAIN_SKILL_CAPABILITIES,
	type InstalledSkill,
	type SkillInfo,
	type SkillSetEnabledResult,
	type SkillType,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginSkillMethods = {
	listSkills(this: PluginCapabilitySessionAccess, sessionId: string, cwd?: string): Promise<SkillInfo[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SKILL_CAPABILITIES.LIST, {
			...(cwd === undefined ? {} : { cwd }),
		});
	},

	listInstalledSkills(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
	): Promise<Record<string, InstalledSkill>> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED, {});
	},

	async setSkillEnabled(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		enabled: boolean,
	): Promise<SkillSetEnabledResult> {
		const manifest = await this.client(sessionId, { official: true }).invoke(
			DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED,
			{},
		);
		const entry = manifest[name];
		if (!entry) throw new Error(`Installed skill/scene not found: ${name}`);
		if (entry.enabled === enabled) return { name, enabled };
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SKILL_CAPABILITIES.SET_ENABLED, {
			name,
			enabled,
		});
	},

	async uninstallSkill(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		type?: SkillType,
	): Promise<undefined> {
		const manifest = await this.client(sessionId, { official: true }).invoke(
			DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED,
			{},
		);
		const entry = manifest[name];
		if (!entry) throw new Error(`Installed skill/scene not found: ${name}`);
		const resolvedType = type ?? (entry.type === "scene" ? "scene" : "skill");
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SKILL_CAPABILITIES.UNINSTALL, {
			name,
			type: resolvedType,
		});
	},
};

export type PluginSkillMethods = typeof pluginSkillMethods;
