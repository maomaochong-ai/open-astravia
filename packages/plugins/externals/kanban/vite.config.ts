import tailwindcss from "@tailwindcss/vite";
import { astraviaPluginFederation } from "@astravia-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		astraviaPluginFederation({
			name: "kanban",
			entry: "./src/index.tsx",
			hostUi: true,
			hostThemeUi: true,
		}),
	],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
});
