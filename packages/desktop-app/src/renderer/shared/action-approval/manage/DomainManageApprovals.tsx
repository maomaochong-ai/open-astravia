import { AgentSetExperimentalApproval } from "./agent";
import { AppearanceSetLanguageApproval } from "./appearance";
import { DownloadsCancelApproval } from "./downloads";
import {
	GeneralSetExecutionModeApproval,
	GeneralSetNotificationsApproval,
	GeneralSetWorkspaceApproval,
} from "./general";
import {
	ImRestartApproval,
	ImSetAgentModelApproval,
	ImSetEnabledApproval,
	ImSetFeishuConfigApproval,
} from "./im";
import {
	KnowledgeAddFilesApproval,
	KnowledgeCreateApproval,
	KnowledgeDeleteApproval,
	KnowledgeDeleteEntryApproval,
	KnowledgeRenameApproval,
	KnowledgeRetryFailedApproval,
	KnowledgeScanNowApproval,
	KnowledgeSetProcessingApproval,
} from "./knowledge";
import { McpRemoveApproval, McpSetEnabledApproval, McpUpsertApproval } from "./mcp";
import {
	ModelsRemoveProviderApproval,
	ModelsSetDefaultApproval,
	ModelsUpsertProviderApproval,
} from "./models";
import {
	PluginsInstallFromPathApproval,
	PluginsInstallFromUrlApproval,
	PluginsReloadApproval,
	PluginsSetEnabledApproval,
	PluginsUninstallApproval,
} from "./plugins";
import {
	ProjectsArchiveApproval,
	ProjectsCreateApproval,
	ProjectsOpenApproval,
	ProjectsRemoveApproval,
	ProjectsRenameApproval,
	ProjectsUnarchiveApproval,
} from "./projects";
import {
	ShortcutsResetAllBindingsApproval,
	ShortcutsResetBindingApproval,
	ShortcutsSetBindingApproval,
	ShortcutsSetQuickPanelBehaviorApproval,
	ShortcutsSetQuickPanelTriggerApproval,
} from "./shortcuts";
import {
	SkillsInstallFromMarketApproval,
	SkillsSetEnabledApproval,
	SkillsUninstallApproval,
} from "./skills";
import {
	UpdaterCancelApproval,
	UpdaterCheckApproval,
	UpdaterDismissApproval,
	UpdaterDownloadApproval,
	UpdaterInstallApproval,
} from "./updater";
import {
	WebhookCreateApproval,
	WebhookDeleteApproval,
	WebhookSendApproval,
	WebhookSetEnabledApproval,
	WebhookTestApproval,
	WebhookUpdateApproval,
} from "./webhook";

/**
 * 挂载全部领域 manage 审批 presenter。
 * 按 operation 拆分（对齐 scheduler）：每个组件只绑定一个 presentation。
 */
export function DomainManageApprovals(): JSX.Element {
	return (
		<>
			<ModelsSetDefaultApproval />
			<ModelsUpsertProviderApproval />
			<ModelsRemoveProviderApproval />

			<McpUpsertApproval />
			<McpSetEnabledApproval />
			<McpRemoveApproval />

			<SkillsSetEnabledApproval />
			<SkillsUninstallApproval />
			<SkillsInstallFromMarketApproval />

			<ProjectsCreateApproval />
			<ProjectsOpenApproval />
			<ProjectsRenameApproval />
			<ProjectsArchiveApproval />
			<ProjectsUnarchiveApproval />
			<ProjectsRemoveApproval />

			<AppearanceSetLanguageApproval />

			<GeneralSetNotificationsApproval />
			<GeneralSetExecutionModeApproval />
			<GeneralSetWorkspaceApproval />

			<ShortcutsSetBindingApproval />
			<ShortcutsResetBindingApproval />
			<ShortcutsResetAllBindingsApproval />
			<ShortcutsSetQuickPanelTriggerApproval />
			<ShortcutsSetQuickPanelBehaviorApproval />

			<AgentSetExperimentalApproval />

			<KnowledgeCreateApproval />
			<KnowledgeRenameApproval />
			<KnowledgeDeleteApproval />
			<KnowledgeAddFilesApproval />
			<KnowledgeDeleteEntryApproval />
			<KnowledgeScanNowApproval />
			<KnowledgeRetryFailedApproval />
			<KnowledgeSetProcessingApproval />

			<PluginsSetEnabledApproval />
			<PluginsInstallFromUrlApproval />
			<PluginsInstallFromPathApproval />
			<PluginsUninstallApproval />
			<PluginsReloadApproval />

			<ImSetEnabledApproval />
			<ImRestartApproval />
			<ImSetAgentModelApproval />
			<ImSetFeishuConfigApproval />

			<WebhookCreateApproval />
			<WebhookUpdateApproval />
			<WebhookSetEnabledApproval />
			<WebhookDeleteApproval />
			<WebhookTestApproval />
			<WebhookSendApproval />

			<DownloadsCancelApproval />

			<UpdaterCheckApproval />
			<UpdaterDownloadApproval />
			<UpdaterInstallApproval />
			<UpdaterDismissApproval />
			<UpdaterCancelApproval />
		</>
	);
}
