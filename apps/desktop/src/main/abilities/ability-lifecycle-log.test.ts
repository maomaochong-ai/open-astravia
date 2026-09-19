import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info }) }));

import { logAbilityLifecycleEvent, logAbilityRuntimeLoaded } from "./ability-lifecycle-log.js";

describe("ability lifecycle log", () => {
	beforeEach(() => info.mockClear());

	it("uses one structured lifecycle format for every ability type", () => {
		logAbilityLifecycleEvent({
			type: "resource.lifecycle",
			resourceKind: "mcp",
			resourceId: "demo-server",
			operation: "enabled",
			source: "market",
		});

		expect(info).toHaveBeenCalledWith("lifecycle completed", {
			abilityType: "mcp",
			abilityId: "demo-server",
			operation: "enabled",
			source: "market",
		});
	});

	it("records a successful runtime load separately from configuration changes", () => {
		logAbilityRuntimeLoaded({
			abilityType: "plugin",
			abilityId: "demo-plugin",
			version: "1.2.3",
			source: "remote",
			activationId: "activation-1",
		});

		expect(info).toHaveBeenCalledWith("runtime loaded", {
			abilityType: "plugin",
			abilityId: "demo-plugin",
			version: "1.2.3",
			source: "remote",
			activationId: "activation-1",
		});
	});
});
