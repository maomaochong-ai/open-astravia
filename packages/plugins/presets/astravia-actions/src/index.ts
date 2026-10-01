import { definePlugin } from "@astravia-org/plugin-sdk";
import { registerAgentActions } from "./domains/agent";
import { registerAppearanceActions } from "./domains/appearance";
import { registerBatchTasksActions } from "./domains/batch-tasks";
import { registerDownloadsActions } from "./domains/downloads";
import { registerGeneralActions } from "./domains/general";
import { registerImActions } from "./domains/im";
import { registerKnowledgeActions } from "./domains/knowledge";
import { registerMcpActions } from "./domains/mcp";
import { registerModelsActions } from "./domains/models";
import { registerNavigationActions } from "./domains/navigation";
import { registerPluginsActions } from "./domains/plugins";
import { registerProjectsActions } from "./domains/projects";
import { registerSchedulerActions } from "./domains/scheduler";
import { registerShortcutsActions } from "./domains/shortcuts";
import { registerSkillsActions } from "./domains/skills";
import { registerUpdaterActions } from "./domains/updater";
import { registerWebhookActions } from "./domains/webhook";

export default definePlugin({
	activate(ctx) {
		registerGeneralActions(ctx);
		registerAgentActions(ctx);
		registerDownloadsActions(ctx);
		registerUpdaterActions(ctx);
		registerWebhookActions(ctx);
		registerSkillsActions(ctx);
		registerShortcutsActions(ctx);
		registerImActions(ctx);
		registerMcpActions(ctx);
		registerModelsActions(ctx);
		registerProjectsActions(ctx);
		registerKnowledgeActions(ctx);
		registerPluginsActions(ctx);
		registerBatchTasksActions(ctx);
		registerSchedulerActions(ctx);
		registerAppearanceActions(ctx);
		registerNavigationActions(ctx);
	},
});
