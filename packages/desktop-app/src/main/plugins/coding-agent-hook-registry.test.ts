import { describe, expect, it } from "vitest";
import { DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";

describe("DesktopPluginHookRegistry", () => {
	it("replaces registrations by plugin and hook id while stale activations cannot remove the replacement", () => {
		const registry = new DesktopPluginHookRegistry();
		registry.register("plugin-a", registration("activation-1", "handler-1"));
		const inFlight = registry.snapshot();
		registry.register("plugin-a", registration("activation-2", "handler-2"));

		expect(registry.unregister("plugin-a", "guard", "activation-1")).toBe(false);
		expect(registry.snapshot()).toMatchObject([{ activationId: "activation-2", handlerId: "handler-2" }]);
		expect(inFlight).toMatchObject([{ activationId: "activation-1", handlerId: "handler-1" }]);
	});

	it("returns immutable dispatch snapshots and clears one plugin without affecting another", () => {
		const registry = new DesktopPluginHookRegistry();
		registry.register("plugin-a", registration("activation-a", "handler-a"));
		registry.register("plugin-b", registration("activation-b", "handler-b"));
		const snapshot = registry.snapshot();

		expect(registry.clear("plugin-a")).toBe(1);
		expect(registry.snapshot().map((binding) => binding.pluginId)).toEqual(["plugin-b"]);
		expect(snapshot.map((binding) => binding.pluginId)).toEqual(["plugin-a", "plugin-b"]);
	});

	it("does not let an activation-scoped unregister delete an unscoped or different binding", () => {
		const registry = new DesktopPluginHookRegistry();
		registry.register("plugin-a", registration(undefined, "handler-current"));

		expect(registry.unregister("plugin-a", "guard", "activation-old")).toBe(false);
		expect(registry.snapshot()).toMatchObject([{ handlerId: "handler-current" }]);
	});
});

function registration(activationId: string | undefined, handlerId: string) {
	return {
		id: "guard",
		eventName: "PreToolUse" as const,
		handlerId,
		activationId,
		scope_use: ["cli"],
	};
}
