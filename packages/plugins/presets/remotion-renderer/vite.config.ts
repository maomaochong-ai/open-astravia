import { astraviaPluginFederation } from "@astravia-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		astraviaPluginFederation({
			name: "remotion_renderer",
			entry: "./src/index.ts",
			hostUi: true,
		}),
	],
});
