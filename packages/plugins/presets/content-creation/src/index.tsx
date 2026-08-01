import { definePlugin } from "@vetta-org/plugin-sdk";
import "@xyflow/react/dist/style.css";
import "./style.css";
import { registerContentCreationTools } from "./agent/register-tools";
import { ContentCreationIcon } from "./components/icons";
import { ContentCreationPanel } from "./components/ContentCreationPanel";
import { initializePluginRuntime } from "./runtime/plugin-runtime";

export default definePlugin({
	activate(ctx) {
		const workspace = initializePluginRuntime(ctx);
		ctx.ui.registerActivityTab({
			id: "workspace",
			label: "%tab.workspace.label%",
			icon: <ContentCreationIcon className="h-4 w-4" />,
			component: ContentCreationPanel,
			scope_use: ["conversation", "project"],
			// 默认不上栏；agent open_content_creation / 用户从「+」添加后再挂上。
			initiallyVisible: false,
		});
		registerContentCreationTools(ctx, workspace);
	},
});
