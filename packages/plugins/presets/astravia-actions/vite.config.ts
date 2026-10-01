import { astraviaPluginFederation } from "@astravia-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		astraviaPluginFederation({
			name: "astravia_actions",
			entry: "./src/index.ts",
		}),
	],
});
