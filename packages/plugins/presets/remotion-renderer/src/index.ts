import { definePlugin } from "@vetta-org/plugin-sdk";
import { stopRemotionServer } from "./engine/engine-manager";
import { createRemotionProvider } from "./provider/remotion-provider";
import { registerRenderTool } from "./tools/render-tool";

export default definePlugin({
	activate(ctx) {
		ctx.media.registerProvider(createRemotionProvider(ctx));
		registerRenderTool(ctx);
	},
	deactivate() {
		return stopRemotionServer();
	},
});

