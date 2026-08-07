import { definePlugin } from "@vetta-org/plugin-sdk";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { setActivityPanelWidthController, setRegisterShortcutScope } from "./plugin/plugin-ui";
import { registerContentCreationTools } from "./plugin/register-tools";
import { ContentCreationPanel } from "./panel/ContentCreationPanel";
import { initializePluginRuntime } from "./plugin/runtime";

export default definePlugin({
	async activate(ctx) {
		const workspace = await initializePluginRuntime(ctx);
		setRegisterShortcutScope((contribution) => ctx.ui.registerShortcutScope(contribution));
		setActivityPanelWidthController((width) => ctx.ui.setActivityPanelWidth(width));
		ctx.ui.registerActivityTab({
			id: "workspace",
			label: "%tab.workspace.label%",
			icon: <span className="icon-[lucide--wand-sparkles] block h-4 w-4 shrink-0" aria-hidden="true" />,
			component: ContentCreationPanel,
			scope_use: ["conversation", "project"],
			// 默认不上栏；agent open_content_creation / 用户从「+」添加后再挂上。
			initiallyVisible: false,
		});
		registerContentCreationTools(ctx, workspace);
	},
	deactivate() {
		setRegisterShortcutScope(null);
		setActivityPanelWidthController(null);
	},
});
