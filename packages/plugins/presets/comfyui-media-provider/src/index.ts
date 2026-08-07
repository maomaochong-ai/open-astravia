import { definePlugin } from "@vetta-org/plugin-sdk";
import { createComfyUiProvider } from "./provider";

export default definePlugin({
	activate(ctx) {
		ctx.media.registerProvider(createComfyUiProvider(ctx));
	},
});

