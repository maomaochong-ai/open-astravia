import { join } from "node:path";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";
import { CONFIG_DIR_NAME } from "../identity.js";
import { SettingsRuntime } from "../settings/index.js";
import { getAgentDir } from "./node-config.js";

/** Compatibility adapter for Coding Agent entry points that still provide a Node host. */
export function createCodingAgentNodeSettingsRuntime(cwd = process.cwd(), agentDir = getAgentDir()): SettingsRuntime {
	return SettingsRuntime.fromStorage(
		new NodeScopedTextStorage({
			global: join(agentDir, "settings.json"),
			project: join(cwd, CONFIG_DIR_NAME, "settings.json"),
		}),
		{
			clearOnShrink: process.env.PI_CLEAR_ON_SHRINK === "1",
			showHardwareCursor: process.env.PI_HARDWARE_CURSOR === "1",
		},
	);
}
