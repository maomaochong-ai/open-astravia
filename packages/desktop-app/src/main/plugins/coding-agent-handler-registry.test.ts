import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { DesktopPluginAgentHandlerRegistry } from "./coding-agent-handler-registry.js";

describe("DesktopPluginAgentHandlerRegistry", () => {
	it("keeps retired renderer handlers alive until the admitted Turn releases them", async () => {
		const registry = new DesktopPluginAgentHandlerRegistry();
		const released = vi.fn();
		registry.onReleased(released);
		registry.register({
			kind: "tool",
			pluginId: "demo",
			handlerId: "handler-1",
			activationId: "activation-1",
		});
		const lease = registry.acquire(config("handler-1", "activation-1"));

		registry.unregister("tool", "demo", "handler-1");
		expect(registry.readInvocationRejection("tool", "demo", "handler-1", "activation-1")).toBeUndefined();
		expect(released).not.toHaveBeenCalled();
		expect(registry.readLeaseDiagnostics()).toEqual({ retiredGenerations: 1, activeLeases: 1 });

		await lease.release();
		expect(released).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "tool", pluginId: "demo", handlerId: "handler-1" }),
		);
		expect(registry.readLeaseDiagnostics()).toEqual({ retiredGenerations: 0, activeLeases: 0 });
	});

	it("keeps same-id activation generations independently addressable", () => {
		const registry = new DesktopPluginAgentHandlerRegistry();
		registry.register({
			kind: "tool",
			pluginId: "demo",
			handlerId: "shared-handler",
			activationId: "activation-1",
		});
		const firstLease = registry.acquire(config("shared-handler", "activation-1"));
		registry.register({
			kind: "tool",
			pluginId: "demo",
			handlerId: "shared-handler",
			activationId: "activation-2",
		});
		const secondLease = registry.acquire(config("shared-handler", "activation-2"));

		expect(registry.readInvocationRejection("tool", "demo", "shared-handler", "activation-1")).toBeUndefined();
		expect(registry.readInvocationRejection("tool", "demo", "shared-handler", "activation-2")).toBeUndefined();

		firstLease.release();
		secondLease.release();
	});

	it("applies hard revoke to selected handler kinds without treating ordinary retirement as revocation", () => {
		const registry = new DesktopPluginAgentHandlerRegistry();
		registry.register({ kind: "tool", pluginId: "demo", handlerId: "tool-handler" });
		registry.register({ kind: "continuation", pluginId: "demo", handlerId: "continuation-handler" });
		const lease = registry.acquire({
			toolContributions: [toolContribution("tool-handler")],
			continuationContributions: [{ pluginId: "demo", id: "continue", handlerId: "continuation-handler" }],
		});

		expect(registry.hardRevoke("demo", "tool permission revoked", new Set(["tool"]))).toBe(1);
		expect(registry.readInvocationRejection("tool", "demo", "tool-handler")).toBe("tool permission revoked");
		expect(registry.readInvocationRejection("continuation", "demo", "continuation-handler")).toBeUndefined();

		lease.release();
	});
});

function config(handlerId: string, activationId?: string): AgentPluginRuntimeConfig {
	return { toolContributions: [{ ...toolContribution(handlerId), activationId }] };
}

function toolContribution(handlerId: string) {
	return {
		pluginId: "demo",
		id: "tool",
		name: "demo_tool",
		description: "Demo",
		parameters: { type: "object" },
		handlerId,
	};
}
