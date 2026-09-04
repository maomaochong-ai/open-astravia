import { definePlugin } from "@vetta-org/plugin-sdk";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { ContentRunApprovalDialog } from "./plugin/ContentRunApprovalDialog";
import { registerContentCreationTools } from "./plugin/tools";
import { ContentCreationPanel } from "./panel/ContentCreationPanel";
import { ContentCreationPluginRuntime } from "./plugin/runtime";
import { ContentSettingsView } from "./settings/SettingsView";
import { SETTINGS_VIEW_ID } from "./settings/view-id";

export default definePlugin({
	async activate(ctx) {
		const runtime = await ContentCreationPluginRuntime.create(ctx);
		const cleanup = () => {
			try {
				runtime.publishPromptAttachment(null);
			} finally {
				runtime.dispose();
			}
		};
		try {
			// Each contribution closes over this activation's runtime instead of reading module state.
			const WorkspacePanel = () => <ContentCreationPanel runtime={runtime} />;
			const RunApprovalDialog = () => <ContentRunApprovalDialog runtime={runtime} />;
			// icon 省略：宿主用 plugin.json#icon → ctx.plugin.iconUrl 填品牌图。
			ctx.ui.registerActivityTab({
				id: "workspace",
				label: "%tab.workspace.label%",
				component: WorkspacePanel,
				scope_use: ["conversation", "project"],
				// 默认上栏；工具注入由 agent.tools 与路由独立贡献，不再经输入栏开关门控。
				initiallyVisible: true,
			});
			ctx.ui.registerWorkspaceView({
				id: SETTINGS_VIEW_ID,
				label: "%settings.page.title%",
				description: "%settings.page.tagline%",
				// 不声明 icon：宿主回落到 plugin.json 里的品牌图标。
				iconTint: false,
				component: function ContentCreationSettingsView() {
					return <ContentSettingsView store={runtime.settings} />;
				},
			});
			ctx.ui.registerGlobalSlot({ id: "run-approval", component: RunApprovalDialog });
			registerContentCreationTools(ctx, runtime.agent, runtime.runApprovals, runtime.localAssets);
			return cleanup;
		} catch (error) {
			cleanup();
			throw error;
		}
	},
});
