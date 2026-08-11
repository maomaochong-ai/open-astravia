import { definePlugin } from "@vetta-org/plugin-sdk";
import "@xyflow/react/dist/style.css";
import pluginIconUrl from "../icon.png";
import "./styles/index.css";
import { ContentRunApprovalDialog } from "./plugin/ContentRunApprovalDialog";
import { registerContentCreationTools } from "./plugin/register-tools";
import { registerContentCreationToolRouter } from "./plugin/tool-routing";
import { ContentCreationPanel } from "./panel/ContentCreationPanel";
import { ContentCreationPluginRuntime } from "./plugin/runtime";

function PluginTabIcon() {
	// 与 plugin.json#icon 同源（icon.png），活动栏与插件列表品牌一致。
	return <img src={pluginIconUrl} alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />;
}

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
			ctx.ui.registerActivityTab({
				id: "workspace",
				label: "%tab.workspace.label%",
				icon: <PluginTabIcon />,
				component: WorkspacePanel,
				scope_use: ["conversation", "project"],
				// 暂时默认上栏；硬隔离已去掉，后续再设计更合适的入口策略。
				initiallyVisible: true,
			});
			ctx.ui.registerInputAction({
				id: "mode",
				label: "%action.mode.label%",
				icon: <span className="icon-[lucide--wand-sparkles] block size-3.5" aria-hidden="true" />,
				defaultActive: false,
				scope_use: ["conversation", "project"],
				// 软开关：只控制 tab 显隐与 prompt 装饰，不再 gate Agent 贡献。
				onToggle: (active) => ctx.ui.setActivityTabVisible("workspace", active),
				decoratePrompt: () => ({
					instructions: [
						"Content creation mode is active. Use the relevant bundled content-creation skills and the narrowest available content_creation tool.",
					],
				}),
			});
			ctx.ui.registerGlobalSlot({ id: "run-approval", component: RunApprovalDialog });
			registerContentCreationTools(ctx, runtime.agent, runtime.runApprovals);
			registerContentCreationToolRouter(ctx);
			return cleanup;
		} catch (error) {
			cleanup();
			throw error;
		}
	},
});
