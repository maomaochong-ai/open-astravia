/**
 * Knip config for optional dead-code / unused-export reporting.
 *
 * Not part of the required `bun run check` gate yet — monorepo false positives
 * are still being tuned. Use:
 *   bun run deadcode:report   # print findings (knip --no-exit-code)
 *   bun run deadcode          # exit non-zero on findings
 *
 * Scope starts small (core libs with real test surfaces) to keep signal usable.
 *
 * @type {import("knip").KnipConfig}
 */
const config = {
	ignoreWorkspaces: [
		"packages/action-rpc",
		"apps/admin",
		"apps/cli-app",
		"packages/coding-agent/examples/**",
		"apps/desktop-app",
		"packages/markdown",
		"packages/plugins/**",
		"packages/runtime-*",
		"apps/site",
		"packages/theme-*",
		"packages/themes/**",
		"packages/toolkit",
		"packages/ui",
	],
	workspaces: {
		".": {
			entry: ["scripts/**/*.{js,mjs,ts}"],
			project: ["scripts/**/*.{js,mjs,ts}"],
			// The root manifest also acts as a Bun workspace hoist/launcher manifest.
			// Dependency ownership is checked in the selected package workspaces below.
			ignoreDependencies: [
				"@mariozechner/jiti",
				"@playwright/cli",
				"@radix-ui/react-popover",
				"@radix-ui/react-select",
				"@radix-ui/react-slot",
				"@vetta/cli-app",
				"@vetta/coding-agent",
				"date-fns",
				"get-east-asian-width",
				"koffi",
				"tsx",
			],
		},
		"packages/ai": {
			entry: ["src/index.ts", "src/cli.ts", "src/reasoning-presets.ts"],
			project: ["src/**/*.ts", "test/**/*.ts"],
		},
		"packages/agent": {
			entry: ["src/index.ts"],
			project: ["src/**/*.ts", "test/**/*.ts"],
		},
		"packages/coding-agent": {
			entry: [
				"src/index.ts",
				"src/cli.ts",
				"src/core/hooks/index.ts",
				"src/core/settings-manager.ts",
				"src/core/mcp/index.ts",
				"src/core/mcp/types.ts",
				"src/core/resolve-config-value.ts",
			],
			project: ["src/**/*.ts", "test/**/*.ts"],
		},
		"packages/ecosystem-adapter": {
			entry: ["src/index.ts", "src/hooks/index.ts", "src/codex/hooks/index.ts", "src/claude-code/hooks/index.ts"],
			project: ["src/**/*.ts", "test/**/*.ts"],
		},
	},
	exclude: ["duplicates"],
	ignoreExportsUsedInFile: true,
};

export default config;
