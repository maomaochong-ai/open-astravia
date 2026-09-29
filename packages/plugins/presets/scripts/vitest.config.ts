import { defineConfig } from "vitest/config";

export default defineConfig({
	esbuild: { jsx: "automatic" },
	resolve: {
		dedupe: ["react", "react-dom"],
	},
	test: {
		setupFiles: ["./test/setup.ts"],
		include: ["test/**/*.test.{ts,tsx}"],
		server: { deps: { inline: ["radix-ui", /@radix-ui\//] } },
	},
});
