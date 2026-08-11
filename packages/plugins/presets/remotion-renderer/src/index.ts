import { definePlugin } from "@vetta-org/plugin-sdk";
import { stopRemotionServer } from "./engine/engine-manager";
import { createRemotionProvider } from "./provider/remotion-provider";
import { setPluginContext } from "./runtime";
import { RemotionStudioPanel } from "./studio/RemotionStudioPanel";
import { stopAllRemotionStudios } from "./studio/studio-manager";
import { registerRenderTool } from "./tools/render-tool";

export default definePlugin({
	activate(ctx) {
		setPluginContext(ctx);
		ctx.ui.registerActivityTab({
			id: "studio",
			label: "%tab.studio%",
			component: RemotionStudioPanel,
			scope_use: ["conversation", "project"],
			retention: "pinned",
		});
		ctx.media.registerProvider(createRemotionProvider(ctx));
		registerRenderTool(ctx);
	},
	deactivate() {
		// The host activates the replacement before disposing the previous instance.
		// Keep the latest context so the old deactivation cannot invalidate live tabs.
		return Promise.all([stopRemotionServer(), stopAllRemotionStudios()]).then(() => undefined);
	},
});
