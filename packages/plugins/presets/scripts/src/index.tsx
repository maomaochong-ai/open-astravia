import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import { ScriptsPanel } from "./components/ScriptsPanel";
import { setScriptsFs } from "./runtime";

export default definePlugin({
	activate(ctx) {
		setScriptsFs(ctx.fs);
		ctx.ui.registerBottomPanel({
			id: "scripts",
			label: "%panel.label%",
			icon: "icon-[mdi--script-text-play-outline]",
			component: ScriptsPanel,
			scope_use: ["project"],
			// 一份列表就够了：要跑的东西都开成独立的终端 tab。
			maxInstances: 1,
		});
	},
	deactivate() {
		setScriptsFs(undefined);
	},
});
