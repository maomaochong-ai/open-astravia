import { definePlugin } from "@vetta-org/plugin-sdk";
import "@xyflow/react/dist/style.css";
import pluginIconUrl from "../icon.png";
import "./styles/index.css";
import {
	publishPromptAttachment,
	setActivityPanelWidthController,
	setPromptAttachmentController,
	setRegisterShortcutScope,
} from "./plugin/plugin-ui";
import { ContentChangePreviewCard, ContentRunCard } from "./plugin/AgentCards";
import {
	CONTENT_CHANGE_PREVIEW_CARD_TYPE,
	CONTENT_PREPARE_RUN_TOOL_NAME,
	CONTENT_PREVIEW_TOOL_NAME,
	CONTENT_RUN_CARD_TYPE,
	registerContentCreationTools,
} from "./plugin/register-tools";
import { ContentCreationPanel } from "./panel/ContentCreationPanel";
import {
	disposePluginRuntime,
	getContentCreationAgentService,
	initializePluginRuntime,
} from "./plugin/runtime";

function PluginTabIcon() {
	// 与 plugin.json#icon 同源（icon.png），活动栏与插件列表品牌一致。
	return <img src={pluginIconUrl} alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />;
}

export default definePlugin({
	async activate(ctx) {
		await initializePluginRuntime(ctx);
		setRegisterShortcutScope((contribution) => ctx.ui.registerShortcutScope(contribution));
		setActivityPanelWidthController((width) => ctx.ui.setActivityPanelWidth(width));
		setPromptAttachmentController((attachment) => ctx.ui.setPromptAttachment(attachment));
		ctx.ui.registerActivityTab({
			id: "workspace",
			label: "%tab.workspace.label%",
			icon: <PluginTabIcon />,
			component: ContentCreationPanel,
			scope_use: ["conversation", "project"],
			// 默认不上栏；agent open_content_creation / 用户从「+」添加后再挂上。
			initiallyVisible: false,
		});
		ctx.ui.registerCardRenderer({
			type: CONTENT_CHANGE_PREVIEW_CARD_TYPE,
			title: "%card.preview.title%",
			component: ContentChangePreviewCard,
			pendingFor: (toolCall) =>
				toolCall.toolName === CONTENT_PREVIEW_TOOL_NAME ? { type: CONTENT_CHANGE_PREVIEW_CARD_TYPE } : null,
		});
		ctx.ui.registerCardRenderer({
			type: CONTENT_RUN_CARD_TYPE,
			title: "%card.run.title%",
			component: ContentRunCard,
			pendingFor: (toolCall) =>
				toolCall.toolName === CONTENT_PREPARE_RUN_TOOL_NAME ? { type: CONTENT_RUN_CARD_TYPE } : null,
		});
		registerContentCreationTools(ctx, getContentCreationAgentService());
	},
	deactivate() {
		publishPromptAttachment(null);
		disposePluginRuntime();
		setRegisterShortcutScope(null);
		setActivityPanelWidthController(null);
		setPromptAttachmentController(null);
	},
});
