import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		setupFiles: ["./test/setup.ts"],
		environment: "happy-dom",
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
	},
});
