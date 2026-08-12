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

	it("retires membership immediately but releases the physical handler after the last Turn lease", () => {
		const registry = new DesktopPluginHookRegistry();
		const released: unknown[] = [];
		registry.onHandlerReleased((handler) => released.push(handler));
		registry.register("plugin-a", registration("activation-1", "handler-1"));
		const lease = registry.acquireSnapshot();

		expect(registry.unregister("plugin-a", "guard", "activation-1")).toBe(true);
		expect(registry.snapshot()).toEqual([]);
		expect(lease.bindings).toMatchObject([{ handlerId: "handler-1" }]);
		expect(released).toEqual([]);
		expect(registry.readLeaseDiagnostics()).toEqual({ retiredGenerations: 1, activeLeases: 1 });

		lease.release();
		expect(released).toEqual([{ pluginId: "plugin-a", handlerId: "handler-1", activationId: "activation-1" }]);
		expect(registry.readLeaseDiagnostics()).toEqual({ retiredGenerations: 0, activeLeases: 0 });
	});

	it("keeps ordinary retirement invocable but rejects an explicit security revocation", () => {
		const registry = new DesktopPluginHookRegistry();
		registry.register("plugin-a", registration("activation-1", "handler-1"));
		const lease = registry.acquireSnapshot();
		registry.unregister("plugin-a", "guard", "activation-1");

		expect(registry.readInvocationRejection("plugin-a", "handler-1", "activation-1")).toBeUndefined();
		expect(registry.hardRevoke("plugin-a", "permission revoked")).toBe(1);
		expect(registry.readInvocationRejection("plugin-a", "handler-1", "activation-1")).toBe("permission revoked");

		lease.release();
		expect(registry.readInvocationRejection("plugin-a", "handler-1", "activation-1")).toBe(
			"Hook handler does not belong to an active Turn lease",
		);
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
