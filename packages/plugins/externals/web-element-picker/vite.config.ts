import tailwindcss from "@tailwindcss/vite";
import { astraviaPluginFederation } from "@astravia-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		astraviaPluginFederation({
			name: "web_element_picker",
			entry: "./src/index.tsx",
			package: true,
		}),
	],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
});
