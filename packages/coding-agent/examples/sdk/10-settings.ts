/**
 * Settings Configuration
 *
 * Override settings using SettingsRuntime.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@vetta/coding-agent/config";
import { createCodingAgentHostWithServices, SettingsRuntime } from "@vetta/coding-agent/host-services";
import { NodeScopedTextStorage } from "@vetta/runtime-node/host";

function createNodeSettingsRuntime() {
	return SettingsRuntime.fromStorage(
		new NodeScopedTextStorage({
			global: join(homedir(), ".vetta", "agent", "settings.json"),
			project: join(process.cwd(), CONFIG_DIR_NAME, "settings.json"),
		}),
	);
}

// Load current settings (merged global + project)
const settingsManagerFromDisk = createNodeSettingsRuntime();
console.log("Current settings:", JSON.stringify(settingsManagerFromDisk.getGlobalSettings(), null, 2));

// Override specific settings
const settingsManager = createNodeSettingsRuntime();
settingsManager.applyOverrides({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
});

const settingsHost = createCodingAgentHostWithServices({
	settings: settingsManager,
});
await settingsHost.createSession({ storage: { kind: "memory" } });
await settingsHost.close();

console.log("Session created with custom settings");

// Setters update memory immediately and queue persistence writes.
// Call flush() when you need a durability boundary.
settingsManager.setDefaultThinkingLevel("low");
await settingsManager.flush();

// Surface settings I/O errors at the app layer.
const settingsErrors = settingsManager.drainErrors();
if (settingsErrors.length > 0) {
	for (const { scope, error } of settingsErrors) {
		console.warn(`Warning (${scope} settings): ${error.message}`);
	}
}

// For testing without file I/O:
const inMemorySettings = SettingsRuntime.inMemory({
	compaction: { enabled: false },
	retry: { enabled: false },
});

const inMemoryHost = createCodingAgentHostWithServices({
	settings: inMemorySettings,
});
await inMemoryHost.createSession({ storage: { kind: "memory" } });
await inMemoryHost.close();

console.log("Test session created with in-memory settings");
