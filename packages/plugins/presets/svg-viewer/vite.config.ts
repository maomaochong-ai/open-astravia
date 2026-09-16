import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		vettaPluginFederation({
			name: "svg_viewer",
			entry: "./src/index.tsx",
			hostUi: true,
		}),
	],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
});
