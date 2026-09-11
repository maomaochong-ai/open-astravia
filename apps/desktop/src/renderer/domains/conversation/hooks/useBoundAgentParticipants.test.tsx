// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_AGENT_PARTICIPANT_ID } from "@shared/conversation";
import { activeSessionAtom } from "@shared/store/atoms";
import { createAgentTeamFixture } from "@vetta/agent-team";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBoundAgentParticipants } from "./useBoundAgentParticipants";

const document = createAgentTeamFixture();
const agent = document.agents.find((candidate) => candidate.name === "Researcher");
if (!agent) throw new Error("missing Agent fixture");

beforeEach(() => {
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: { agentTeams: { list: vi.fn(async () => document) } },
	});
});

function renderWithSession(agentProfileId?: string) {
	const store = createStore();
	store.set(activeSessionAtom, {
		cwd: "C:/workspace",
		sessionPath: "C:/sessions/a.jsonl",
		runtimeId: "session-1",
		...(agentProfileId ? { agentProfileId } : {}),
	});
	const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
		<Provider store={store}>{children}</Provider>
	);
	return renderHook(() => useBoundAgentParticipants(), { wrapper });
}

describe("useBoundAgentParticipants", () => {
	it("names the sole agent author so message turns show that Agent instead of the generic bot", async () => {
		const { result } = renderWithSession(agent.id);

		await waitFor(() => expect(result.current).toHaveLength(1));
		// 普通会话的 Agent 回合 authorId 恒为 default-agent，participant 必须按它对号入座，
		// 否则 MessageListView 查不到人，头像与昵称会回落成通用机器人。
		expect(result.current?.[0]).toMatchObject({
			id: DEFAULT_AGENT_PARTICIPANT_ID,
			kind: "agent",
			name: agent.name,
			blueprintId: agent.blueprintId,
		});
	});

	it("stays empty for an unbound conversation", async () => {
		const { result } = renderWithSession();

		await waitFor(() => expect(window.vetta.agentTeams.list).not.toHaveBeenCalled());
		expect(result.current).toBeUndefined();
	});

	it("falls back to the generic author when the bound Agent was deleted", async () => {
		const { result } = renderWithSession("deleted-agent");

		await waitFor(() => expect(window.vetta.agentTeams.list).toHaveBeenCalled());
		expect(result.current).toBeUndefined();
	});
});
