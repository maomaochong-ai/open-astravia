import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { createSentryBuildSetup, readValue } from "./sentry-vite";

const preloadEntries = {
	index: "src/preload/index.ts",
	pet: "src/preload/pet.ts",
	quickpanel: "src/preload/quickpanel.ts",
	onboarding: "src/preload/onboarding.ts",
} as const;

export default defineConfig(({ mode }) => {
	const entryName = process.env.VETTA_PRELOAD_ENTRY;
	if (!entryName || !(entryName in preloadEntries)) {
		throw new Error(`Invalid VETTA_PRELOAD_ENTRY: ${entryName ?? "missing"}`);
	}
	const preloadEntryName = entryName as keyof typeof preloadEntries;
	const effectiveMode = process.env.VETTA_BUILD_ENV || mode;
	const env = loadEnv(effectiveMode, process.cwd(), "VETTA_");
	const sentry = createSentryBuildSetup(env, "dist/preload");
	return {
		define: {
			"process.env.VETTA_SENTRY_ENABLED": JSON.stringify(
				readValue(env, "VETTA_SENTRY_DSN") ? "true" : "false",
			),
		},
		plugins: [...sentry.plugins],
		build: {
			lib: {
				entry: resolve(process.cwd(), preloadEntries[preloadEntryName]),
				formats: ["cjs"],
				fileName: () => `${preloadEntryName}.js`,
			},
			outDir: resolve(process.cwd(), "dist/preload"),
			emptyOutDir: preloadEntryName === "index",
			sourcemap: sentry.enabled ? "hidden" : false,
			rollupOptions: {
				external: ["electron"],
				output: {
					inlineDynamicImports: true,
				},
			},
		},
	};
});
