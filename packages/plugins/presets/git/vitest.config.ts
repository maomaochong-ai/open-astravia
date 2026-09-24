import { defineConfig } from "vitest/config";

export default defineConfig({
	esbuild: { jsx: "automatic" },
	resolve: {
		dedupe: ["react", "react-dom"],
	},
	ssr: { resolve: { mainFields: ["module", "main"] } },
	test: {
		setupFiles: ["./test/setup.ts"],
		include: ["test/**/*.test.{ts,tsx}"],
		// ESM dependencies use Vite's deduplication; setup.ts handles CJS peers.
		server: {
			deps: {
				inline: [
					"radix-ui",
					/@radix-ui\//,
					/@floating-ui\//,
					"lucide-react",
					/react-remove-scroll/,
					"react-style-singleton",
					"use-callback-ref",
					"use-sidecar",
				],
			},
		},
	},
});
