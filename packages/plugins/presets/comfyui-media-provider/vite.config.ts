import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		vettaPluginFederation({
			name: "comfyui_media_provider",
			entry: "./src/index.ts",
		}),
	],
});
