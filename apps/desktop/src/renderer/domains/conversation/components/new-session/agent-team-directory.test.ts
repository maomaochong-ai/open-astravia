// @vitest-environment jsdom

import type { AgentTeamDocument } from "@vetta/agent-team";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cachedAgentTeamDocument,
	loadAgentTeamDocument,
	resetAgentTeamDirectoryForTest,
	subscribeAgentTeamDocument,
} from "./agent-team-directory";

function document(revision: number): AgentTeamDocument {
	return { schemaVersion: 1, revision, agents: [], teams: [] } as unknown as AgentTeamDocument;
}

function installApi(list: () => Promise<AgentTeamDocument>): { notifyChanged: () => void } {
	const listeners = new Set<() => void>();
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			agentTeams: {
				list,
				onChanged: (listener: () => void) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		},
	});
	return {
		notifyChanged: () => {
			for (const listener of [...listeners]) listener();
		},
	};
}

afterEach(() => resetAgentTeamDirectoryForTest());

describe("new session agent team directory", () => {
	it("refetches and republishes when the main process reapplies the plugin presets", async () => {
		let revision = 1;
		const list = vi.fn(async () => document(revision));
		const { notifyChanged } = installApi(list);
		const seen = vi.fn();
		subscribeAgentTeamDocument(seen);
		await loadAgentTeamDocument();
		expect(cachedAgentTeamDocument()?.revision).toBe(1);

		// 插件热重载不经过渲染进程：不听这条事件，新会话页会一直摆着上一版的阵容。
		revision = 2;
		notifyChanged();
		await vi.waitFor(() => expect(cachedAgentTeamDocument()?.revision).toBe(2));
		expect(seen).toHaveBeenCalledTimes(2);
	});
});
