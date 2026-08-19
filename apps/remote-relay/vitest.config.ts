import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				isolatedStorage: false,
				singleWorker: true,
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
	resolve: {
		alias: {
			"@vetta/remote-control": resolve(__dirname, "../../packages/remote-control/src/index.ts"),
			"@vetta/remote-desktop/protocol": resolve(__dirname, "../../packages/remote-desktop/src/protocol-entry.ts"),
			"@vetta/remote-desktop": resolve(__dirname, "../../packages/remote-desktop/src/index.ts"),
		},
	},
});
