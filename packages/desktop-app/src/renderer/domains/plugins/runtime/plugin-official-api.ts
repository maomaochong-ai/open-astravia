import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";
import { createOfficialAgentApi } from "./plugin-official-agent";
import { createOfficialAppearanceApi } from "./plugin-official-appearance";
import { createOfficialBatchTasksApi } from "./plugin-official-batch-tasks";
import { createOfficialDialogApi } from "./plugin-official-dialog";
import { createOfficialDownloadsApi } from "./plugin-official-downloads";
import { createOfficialGeneralApi } from "./plugin-official-general";
import { createOfficialImApi } from "./plugin-official-im";
import { createOfficialKnowledgeApi } from "./plugin-official-knowledge";
import { createOfficialMcpApi } from "./plugin-official-mcp";
import { createOfficialModelsApi } from "./plugin-official-models";
import { createOfficialNavigationApi } from "./plugin-official-navigation";
import { createOfficialPluginsApi } from "./plugin-official-plugins";
import { createOfficialProjectsApi } from "./plugin-official-projects";
import { createOfficialSchedulerApi } from "./plugin-official-scheduler";
import { createOfficialShortcutsApi } from "./plugin-official-shortcuts";
import { createOfficialSkillsApi } from "./plugin-official-skills";
import { createOfficialUpdaterApi } from "./plugin-official-updater";
import { createOfficialWebhookApi } from "./plugin-official-webhook";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";

export function createPluginOfficialApi(capabilitySessionId: string): PluginOfficialApi {
	const assertOfficial = (): void => {
		pluginRendererCapabilityHost.assertOfficialSession(capabilitySessionId);
	};

	return {
		general: createOfficialGeneralApi(assertOfficial, capabilitySessionId),
		agent: createOfficialAgentApi(assertOfficial, capabilitySessionId),
		downloads: createOfficialDownloadsApi(assertOfficial, capabilitySessionId),
		dialog: createOfficialDialogApi(assertOfficial),
		updater: createOfficialUpdaterApi(assertOfficial, capabilitySessionId),
		webhook: createOfficialWebhookApi(assertOfficial, capabilitySessionId),
		skills: createOfficialSkillsApi(assertOfficial, capabilitySessionId),
		shortcuts: createOfficialShortcutsApi(assertOfficial, capabilitySessionId),
		im: createOfficialImApi(assertOfficial, capabilitySessionId),
		mcp: createOfficialMcpApi(assertOfficial, capabilitySessionId),
		models: createOfficialModelsApi(assertOfficial, capabilitySessionId),
		projects: createOfficialProjectsApi(assertOfficial, capabilitySessionId),
		plugins: createOfficialPluginsApi(assertOfficial, capabilitySessionId),
		knowledge: createOfficialKnowledgeApi(assertOfficial, capabilitySessionId),
		batchTasks: createOfficialBatchTasksApi(assertOfficial, capabilitySessionId),
		scheduler: createOfficialSchedulerApi(assertOfficial, capabilitySessionId),
		appearance: createOfficialAppearanceApi(capabilitySessionId),
		navigation: createOfficialNavigationApi(capabilitySessionId),
	};
}
