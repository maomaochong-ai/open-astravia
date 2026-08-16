import { join } from "node:path";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";
import { CONFIG_DIR_NAME } from "../../src/config.js";
import { SettingsRuntime } from "../../src/settings/index.js";

export function createFileSettingsRuntime(projectDir: string, agentDir: string): SettingsRuntime {
	return SettingsRuntime.fromStorage(
		new NodeScopedTextStorage({
			global: join(agentDir, "settings.json"),
			project: join(projectDir, CONFIG_DIR_NAME, "settings.json"),
		}),
	);
}
