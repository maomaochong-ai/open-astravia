import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialSkillsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["skills"] {
	const skills = window.vetta.plugins.internalCapabilities.skills;
	return {
		list: async (cwd) => {
			assertOfficial();
			return skills.list(capabilitySessionId, cwd);
		},
		getManifest: async () => {
			assertOfficial();
			return skills.listInstalled(capabilitySessionId);
		},
		setEnabled: async (name, enabled) => {
			assertOfficial();
			return skills.setEnabled(capabilitySessionId, name, enabled);
		},
		uninstall: async (name, type) => {
			assertOfficial();
			await skills.uninstall(capabilitySessionId, name, type);
		},
		installFromMarket: async (type, slug) => {
			assertOfficial();
			// 市场下载走主进程鉴权/匿名通道，不经 capability session。
			return window.vetta.skills.installFromMarketSlug(type, slug);
		},
	};
}
