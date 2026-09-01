import type { TeamOrchestrationPolicy } from "@vetta/agent-team";
import { beforeEach, describe, expect, it, vi } from "vitest";

const info = vi.fn();
const error = vi.fn();

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info, error, warn: vi.fn(), debug: vi.fn() }),
}));

const { agentTeamExtensionHost, registerAgentTeamExtension } = await import("./agent-team-extension-host.js");

function policy(id: string): TeamOrchestrationPolicy {
	return {
		id,
		resolveTargets: ({ team }) => [team.leaderMemberId],
	};
}

describe("registerAgentTeamExtension", () => {
	beforeEach(() => {
		info.mockClear();
		error.mockClear();
	});

	it("registers and releases trusted policies through the observable host boundary", () => {
		const extensionPolicy = policy("test-policy");
		const unregister = registerAgentTeamExtension("test-extension", {
			orchestrationPolicies: new Map([[extensionPolicy.id, extensionPolicy]]),
		});

		expect(agentTeamExtensionHost.orchestrationPolicies.get(extensionPolicy.id)).toBe(extensionPolicy);
		expect(info).toHaveBeenCalledWith(
			"agent team extension registered",
			expect.objectContaining({ extensionId: "test-extension" }),
		);
		unregister();
		expect(agentTeamExtensionHost.orchestrationPolicies.has(extensionPolicy.id)).toBe(false);
	});

	it("logs registration failures without swallowing them", () => {
		const extensionPolicy = policy("leader-delegates-v1");
		expect(() =>
			registerAgentTeamExtension("conflict", {
				orchestrationPolicies: new Map([[extensionPolicy.id, extensionPolicy]]),
			}),
		).toThrow("already exists");
		expect(error).toHaveBeenCalledWith(
			"agent team extension registration failed",
			expect.objectContaining({ extensionId: "conflict" }),
		);
	});
});
