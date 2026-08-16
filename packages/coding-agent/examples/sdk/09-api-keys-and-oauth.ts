/**
 * API Keys and OAuth
 *
 * Configure API key resolution via AuthStorage and CodingAgentModelRuntime.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createCodingAgentHostWithServices,
	createCodingAgentModelRuntime,
} from "@vetta/coding-agent/host-services";
import { NodeTransactionalTextStorage } from "@vetta/runtime-node/host";

// The Node host explicitly chooses ~/.vetta/agent/auth.json.
// CodingAgentModelRuntime loads built-in + custom models from ~/.vetta/agent/models.json
const authStorage = AuthStorage.fromStorage(
	new NodeTransactionalTextStorage(join(homedir(), ".vetta", "agent", "auth.json")),
);
const modelRuntime = createCodingAgentModelRuntime(authStorage);

const defaultHost = createCodingAgentHostWithServices({
	authStorage,
	modelRuntime,
});
await defaultHost.createSession({ storage: { kind: "memory" } });
await defaultHost.close();
console.log("Session with default auth storage and model registry");

// Custom auth storage location
const customAuthStorage = AuthStorage.fromStorage(new NodeTransactionalTextStorage("/tmp/my-app/auth.json"));
const customModelRuntime = createCodingAgentModelRuntime(customAuthStorage, {
	modelsJsonPath: "/tmp/my-app/models.json",
});

const customHost = createCodingAgentHostWithServices({
	authStorage: customAuthStorage,
	modelRuntime: customModelRuntime,
});
await customHost.createSession({ storage: { kind: "memory" } });
await customHost.close();
console.log("Session with custom auth storage location");

// Runtime API key override (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-my-temp-key");
const runtimeKeyHost = createCodingAgentHostWithServices({
	authStorage,
	modelRuntime,
});
await runtimeKeyHost.createSession({ storage: { kind: "memory" } });
await runtimeKeyHost.close();
console.log("Session with runtime API key override");

// No models.json - only built-in models
const simpleRuntime = createCodingAgentModelRuntime(authStorage);
const simpleHost = createCodingAgentHostWithServices({
	authStorage,
	modelRuntime: simpleRuntime,
});
await simpleHost.createSession({ storage: { kind: "memory" } });
await simpleHost.close();
console.log("Session with only built-in models");
