// @vitest-environment jsdom

import { createAgentTeamFixture } from "@vetta/agent-team";
import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { takeTeamSessionHandoff } from "../../connectors/team/team-session-handoff";
import { teamTargetKey } from "./target";
import { useNewSessionTeamDraft } from "./useNewSessionTeamDraft";

const translate = vi.hoisted(() => (key: string) => key);
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translate }),
}));

const document = createAgentTeamFixture();
const team = document.teams[0];
if (!team) throw new Error("Agent Team fixture is missing");

const snapshot = {
	session: { id: "team-session-1" },
} as DesktopTeamSessionSnapshot;
const reservedSessionId = "11111111-1111-4111-8111-111111111111";

describe("useNewSessionTeamDraft", () => {
	const list = vi.fn(async () => document);
	const createSessionRecord = vi.fn(async () => snapshot);
	const setExecutionMode = vi.fn(async () => snapshot);
	const sendMessage = vi.fn(async () => snapshot);

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(crypto, "randomUUID").mockReturnValue(reservedSessionId);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list, createSessionRecord, setExecutionMode, sendMessage } },
		});
	});

	it("keeps the draft interactive before session creation and sends through the team chain", async () => {
		const onSent = vi.fn();
		const { result } = renderHook(() => useNewSessionTeamDraft(teamTargetKey(team.id), onSent));

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("hello team"));
		await act(async () => {
			await result.current.actions?.send();
		});

		expect(createSessionRecord).not.toHaveBeenCalled();
		expect(setExecutionMode).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
		expect(takeTeamSessionHandoff(reservedSessionId)).toMatchObject({
			text: "hello team",
			requestedMemberIds: [],
			document,
		});
		expect(onSent).toHaveBeenCalledWith(reservedSessionId);
	});

	it("mounts the composer before the team catalog finishes loading", async () => {
		let resolveCatalog: ((value: typeof document) => void) | undefined;
		list.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCatalog = resolve;
				}),
		);
		const { result } = renderHook(() => useNewSessionTeamDraft(teamTargetKey(team.id), vi.fn()));

		expect(result.current.model).not.toBeNull();
		expect(result.current.actions).not.toBeNull();
		expect(result.current.model?.editorEnabled).toBe(true);
		act(() => result.current.actions?.setDraft("首帧可编辑"));
		expect(result.current.model?.draft).toBe("首帧可编辑");

		await act(async () => {
			resolveCatalog?.(document);
		});
		await waitFor(() => expect(result.current.model?.members.length).toBeGreaterThan(0));
	});

	it("navigates at session handoff and keeps edits separate from the sent snapshot", async () => {
		const onSent = vi.fn();
		const { result } = renderHook(() => useNewSessionTeamDraft(teamTargetKey(team.id), onSent));
		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("already sent"));

		await act(async () => {
			await result.current.actions?.send();
		});
		await waitFor(() => expect(onSent).toHaveBeenCalledWith(reservedSessionId));
		act(() => result.current.actions?.setDraft("new draft after handoff"));
		expect(result.current.model?.editorEnabled).toBe(true);
		expect(result.current.model?.status).toBe("ready");
		expect(result.current.model?.draft).toBe("new draft after handoff");

		expect(result.current.model?.draft).toBe("new draft after handoff");
		expect(takeTeamSessionHandoff(reservedSessionId)).toMatchObject({ text: "already sent" });
	});
});
