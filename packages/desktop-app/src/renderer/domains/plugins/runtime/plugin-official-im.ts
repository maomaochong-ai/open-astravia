import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialImApi(assertOfficial: () => void, capabilitySessionId: string): PluginOfficialApi["im"] {
	const im = window.vetta.plugins.internalCapabilities.im;
	const models = window.vetta.plugins.internalCapabilities.models;
	return {
		getStatus: async () => {
			assertOfficial();
			return im.getStatus(capabilitySessionId);
		},
		getLogs: async (limit = 50) => {
			assertOfficial();
			return im.listLogs(capabilitySessionId, limit);
		},
		setEnabled: async (enabled) => {
			assertOfficial();
			return { status: await im.setEnabled(capabilitySessionId, enabled) };
		},
		restart: async () => {
			assertOfficial();
			return { status: await im.restart(capabilitySessionId) };
		},
		setAgentModel: async (modelKey, reasoningLevel) => {
			assertOfficial();
			return { status: await im.setAgentModel(capabilitySessionId, modelKey, reasoningLevel) };
		},
		assertModelKeyExists: async (modelKey) => {
			assertOfficial();
			await models.validateModelKey(capabilitySessionId, modelKey, "set-agent-model");
		},
		setFeishuConfig: async (input) => {
			assertOfficial();
			const current = await window.vetta.im.getConfig();
			const result = await window.vetta.im.setConfig({
				enabled: input.enabled ?? current.enabled,
				transport: "feishu",
				feishu: {
					appId: (input.appId ?? current.feishu.appId).trim(),
					...(input.appSecret !== undefined && input.appSecret !== "" ? { appSecret: input.appSecret } : {}),
					...(input.verificationToken !== undefined && input.verificationToken !== ""
						? { verificationToken: input.verificationToken }
						: {}),
					...(input.encryptKey !== undefined && input.encryptKey !== "" ? { encryptKey: input.encryptKey } : {}),
					...(input.baseUrl !== undefined
						? { baseUrl: input.baseUrl.trim() || undefined }
						: current.feishu.baseUrl
							? { baseUrl: current.feishu.baseUrl }
							: {}),
				},
			});
			return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
		},
	};
}
