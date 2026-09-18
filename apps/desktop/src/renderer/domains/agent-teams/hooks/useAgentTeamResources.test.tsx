// @vitest-environment jsdom

import type { AgentTeamDocument } from "@vetta/agent-team";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentTeamResources } from "./useAgentTeamResources";

const mocks = vi.hoisted(() => ({ load: vi.fn(), waitForPaint: vi.fn() }));

vi.mock("../services/load-agent-team-resources", () => ({
	loadAgentTeamConfigurationResources: mocks.load,
}));

vi.mock("@shared/lib/committed-paint", () => ({
	waitForCommittedPaint: mocks.waitForPaint,
}));

function resources(revision: number) {
	return {
		document: { schemaVersion: 1, revision, agents: [], teams: [] } as unknown as AgentTeamDocument,
		blueprints: [{ id: `blueprint-${revision}` }],
		plugins: [],
		capabilities: [],
	};
}

describe("useAgentTeamResources", () => {
	it("does not fetch team config until the first page paint has committed", async () => {
		let releasePaint: ((value: "painted") => void) | undefined;
		mocks.waitForPaint.mockReturnValue(
			new Promise<"painted">((resolve) => {
				releasePaint = resolve;
			}),
		);
		mocks.load.mockResolvedValue(resources(1));
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list: vi.fn(), onChanged: () => () => undefined } },
		});

		renderHook(() => useAgentTeamResources());
		await Promise.resolve();
		expect(mocks.load).not.toHaveBeenCalled();

		releasePaint?.("painted");
		await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
	});

	it("picks up the new roster when a plugin reapplies its presets", async () => {
		mocks.waitForPaint.mockResolvedValue("painted");
		let revision = 1;
		mocks.load.mockImplementation(async () => resources(revision));
		const listeners = new Set<() => void>();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				agentTeams: {
					list: vi.fn(),
					onChanged: (listener: () => void) => {
						listeners.add(listener);
						return () => listeners.delete(listener);
					},
				},
			},
		});

		const { result } = renderHook(() => useAgentTeamResources());
		await waitFor(() => expect(result.current.document?.revision).toBe(1));

		// 装插件、禁用插件、开发态热重载都走这条事件；不听它，列表要等到重启 App 才变。
		revision = 2;
		for (const listener of [...listeners]) listener();

		await waitFor(() => expect(result.current.document?.revision).toBe(2));
		// 人设与头像同样随插件走，blueprint 要跟着一起重取。
		expect(result.current.blueprints[0]?.id).toBe("blueprint-2");
	});
});
