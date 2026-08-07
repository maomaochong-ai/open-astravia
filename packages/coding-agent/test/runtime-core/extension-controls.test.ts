import { describe, expect, it, vi } from "vitest";
import type { CodingAgentGreenfieldExtensionEventBridge } from "../../src/adapters/runtime-core/greenfield-extension-event-bridge.js";
import {
	type CodingAgentExtensionToolHostPort,
	createCodingAgentRuntimeExtensionControls,
} from "../../src/composition/session-lifecycle/extension-controls.js";
import { InMemoryCodingAgentSessionValueIndex } from "../../src/composition/session-lifecycle/indexes.js";
import type {
	CodingAgentGreenfieldExtensionRunnerPort,
	CodingAgentGreenfieldExtensionToolSource,
} from "../../src/runtime-contracts/index.js";

describe("Coding Agent Runtime Extension Controls", () => {
	it("binds live Event Bridge and Tool Runtime ports with the existing cleanup order", () => {
		const cleanupOrder: string[] = [];
		const bindEvents = vi.fn(() => () => cleanupOrder.push("events"));
		const bridge = {
			bind: bindEvents,
			readSystemPrompt: () => "extension prompt",
		} as unknown as CodingAgentGreenfieldExtensionEventBridge;
		const bindTools = vi.fn(() => () => cleanupOrder.push("tools"));
		const refresh = vi.fn();
		const replaceSessionTools = vi.fn();
		const clearSessionTools = vi.fn();
		const extensionToolRuntime = {
			bindRunner: bindTools,
			refresh,
			replaceSessionTools,
			clearSessionTools,
		} satisfies CodingAgentExtensionToolHostPort;
		const extensionEventBridges =
			new InMemoryCodingAgentSessionValueIndex<CodingAgentGreenfieldExtensionEventBridge>();
		const controls = createCodingAgentRuntimeExtensionControls({
			indexes: { extensionEventBridges },
			extensionToolRuntime,
		});
		extensionEventBridges.set("session", bridge);
		const runner = {} as CodingAgentGreenfieldExtensionRunnerPort;
		const bindingOptions = { replaceExisting: true };
		const extensions: CodingAgentGreenfieldExtensionToolSource[] = [];

		const binding = controls.bindExtensionRunner("session", runner, bindingOptions);
		controls.refreshExtensionTools(extensions);
		controls.replaceSessionTools("session", []);
		controls.clearSessionTools("session");

		expect(binding.readSystemPrompt()).toBe("extension prompt");
		expect(bindEvents).toHaveBeenCalledWith(runner, bindingOptions);
		expect(bindTools).toHaveBeenCalledWith("session", runner, bindingOptions);
		expect(refresh).toHaveBeenCalledWith(extensions);
		expect(replaceSessionTools).toHaveBeenCalledWith("session", []);
		expect(clearSessionTools).toHaveBeenCalledWith("session");
		binding.dispose();
		expect(cleanupOrder).toEqual(["tools", "events"]);
	});

	it("preserves missing-bridge errors and optional Tool Runtime behavior", () => {
		const extensionEventBridges =
			new InMemoryCodingAgentSessionValueIndex<CodingAgentGreenfieldExtensionEventBridge>();
		const controls = createCodingAgentRuntimeExtensionControls({ indexes: { extensionEventBridges } });
		const runner = {} as CodingAgentGreenfieldExtensionRunnerPort;

		expect(() => controls.bindExtensionRunner("missing", runner)).toThrow(
			"Greenfield Extension event bridge not found: missing",
		);
		expect(() => controls.refreshExtensionTools([])).not.toThrow();
		expect(() => controls.replaceSessionTools("missing", [])).toThrow("Session tool runtime is unavailable");
		expect(() => controls.clearSessionTools("missing")).not.toThrow();
	});
});
