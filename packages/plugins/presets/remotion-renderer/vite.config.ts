import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		vettaPluginFederation({
			name: "remotion_renderer",
			entry: "./src/index.ts",
		}),
	],
});

