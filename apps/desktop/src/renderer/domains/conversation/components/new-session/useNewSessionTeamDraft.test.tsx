// @vitest-environment jsdom

import { createAgentTeamFixture } from "@vetta/agent-team";
import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { inputValueAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
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
	const prepareCwd = vi.fn<() => Promise<string | null>>(async () => "C:/projects/selected");
	const options = (onSent = vi.fn()) => ({
		targetKey: teamTargetKey(team.id),
		projectSelection: null,
		prepareCwd,
		onSent,
	});

	beforeEach(() => {
		vi.clearAllMocks();
		getDefaultStore().set(inputValueAtom, "");
		vi.spyOn(crypto, "randomUUID").mockReturnValue(reservedSessionId);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list, createSessionRecord, setExecutionMode, sendMessage } },
		});
	});

	it("keeps one shared draft when the user changes the new-session target", async () => {
		const sharedDraft = "keep this task @C:/workspace/brief.md";
		getDefaultStore().set(inputValueAtom, sharedDraft);
		const teamKey = teamTargetKey(team.id);
		const initialProps: { targetKey: ReturnType<typeof teamTargetKey> | null } = { targetKey: teamKey };
		const { result, rerender } = renderHook(
			({ targetKey }: { targetKey: ReturnType<typeof teamTargetKey> | null }) =>
				useNewSessionTeamDraft({ ...options(), targetKey }),
			{ initialProps },
		);

		await waitFor(() => expect(result.current.model?.members.length).toBeGreaterThan(0));
		expect(result.current.model?.draft).toBe(sharedDraft);
		expect(result.current.model?.attachments).toEqual([
			expect.objectContaining({ path: "C:/workspace/brief.md", kind: "file" }),
		]);

		rerender({ targetKey: null });
		expect(getDefaultStore().get(inputValueAtom)).toBe(sharedDraft);

		rerender({ targetKey: teamKey });
		expect(result.current.model?.draft).toBe(sharedDraft);
	});

	it("restores member mentions only for their original team while keeping the visible text shared", async () => {
		const member = team.members[0];
		if (!member) throw new Error("Agent Team fixture has no member");
		const teamKey = teamTargetKey(team.id);
		const initialProps: { targetKey: ReturnType<typeof teamTargetKey> | null } = { targetKey: teamKey };
		const { result, rerender } = renderHook(
			({ targetKey }: { targetKey: ReturnType<typeof teamTargetKey> | null }) =>
				useNewSessionTeamDraft({ ...options(), targetKey }),
			{ initialProps },
		);

		await waitFor(() => expect(result.current.model?.members.length).toBeGreaterThan(0));
		act(() =>
			result.current.actions?.setDraft(`@${member.handle} review this`, [
				{
					kind: "member",
					memberId: member.id,
					handle: member.handle,
					label: member.handle,
				},
				{ kind: "text", text: " review this" },
			]),
		);

		expect(getDefaultStore().get(inputValueAtom)).toBe(`@${member.handle} review this`);
		expect(result.current.model?.draftMemberMentions).toHaveLength(1);
		expect(result.current.model?.members.find((candidate) => candidate.id === member.id)?.selected).toBe(true);

		rerender({ targetKey: null });
		expect(getDefaultStore().get(inputValueAtom)).toBe(`@${member.handle} review this`);

		rerender({ targetKey: teamTargetKey("another-team") });
		expect(result.current.model?.draft).toBe(`@${member.handle} review this`);
		expect(result.current.model?.draftMemberMentions).toEqual([]);

		rerender({ targetKey: teamKey });
		await waitFor(() => expect(result.current.model?.draftMemberMentions).toHaveLength(1));
		expect(result.current.model?.members.find((candidate) => candidate.id === member.id)?.selected).toBe(true);
	});

	it("does not resurrect stale member routing after the shared draft is cleared", async () => {
		const member = team.members[0];
		if (!member) throw new Error("Agent Team fixture has no member");
		const text = `@${member.handle} review this`;
		const teamKey = teamTargetKey(team.id);
		const initialProps: { targetKey: ReturnType<typeof teamTargetKey> | null } = { targetKey: teamKey };
		const { result, rerender } = renderHook(
			({ targetKey }: { targetKey: ReturnType<typeof teamTargetKey> | null }) =>
				useNewSessionTeamDraft({ ...options(), targetKey }),
			{ initialProps },
		);

		await waitFor(() => expect(result.current.model?.members.length).toBeGreaterThan(0));
		act(() =>
			result.current.actions?.setDraft(text, [
				{ kind: "member", memberId: member.id, handle: member.handle, label: member.handle },
				{ kind: "text", text: " review this" },
			]),
		);
		rerender({ targetKey: null });
		act(() => {
			getDefaultStore().set(inputValueAtom, "");
			getDefaultStore().set(inputValueAtom, text);
		});

		rerender({ targetKey: teamKey });
		expect(result.current.model?.draft).toBe(text);
		expect(result.current.model?.draftMemberMentions).toEqual([]);
	});

	it("keeps the draft interactive before session creation and sends through the team chain", async () => {
		const onSent = vi.fn();
		const { result } = renderHook(() => useNewSessionTeamDraft(options(onSent)));

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("hello team"));
		await act(async () => {
			await result.current.actions?.send();
		});

		expect(createSessionRecord).not.toHaveBeenCalled();
		expect(setExecutionMode).not.toHaveBeenCalled();
		expect(sendMessage).not.toHaveBeenCalled();
		expect(prepareCwd).not.toHaveBeenCalled();
		expect(takeTeamSessionHandoff(reservedSessionId)).toMatchObject({
			text: "hello team",
			memberMentions: [],
			document,
		});
		expect(getDefaultStore().get(inputValueAtom)).toBe("");
		expect(onSent).toHaveBeenCalledWith(reservedSessionId);
	});

	it("captures the selected project as this Team session's workspace", async () => {
		const onSent = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionTeamDraft({
				...options(onSent),
				projectSelection: { kind: "project", cwd: "C:/projects/selected", name: "Selected" },
			}),
		);

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("work in project"));
		await act(async () => result.current.actions?.send());

		expect(prepareCwd).toHaveBeenCalledOnce();
		expect(takeTeamSessionHandoff(reservedSessionId)).toMatchObject({
			workspace: { kind: "project", path: "C:/projects/selected" },
		});
		expect(onSent).toHaveBeenCalledWith(reservedSessionId);
	});

	it("keeps the draft on the new-session page when project preparation fails", async () => {
		prepareCwd.mockResolvedValueOnce(null);
		const onSent = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionTeamDraft({
				...options(onSent),
				projectSelection: { kind: "pending-create", name: "New project" },
			}),
		);

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("keep me"));
		await act(async () => result.current.actions?.send());

		expect(onSent).not.toHaveBeenCalled();
		expect(result.current.model?.draft).toBe("keep me");
	});

	it("deduplicates repeated sends while the selected project is being prepared", async () => {
		let finishPreparing: ((cwd: string) => void) | undefined;
		prepareCwd.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishPreparing = resolve;
				}),
		);
		const onSent = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionTeamDraft({
				...options(onSent),
				projectSelection: { kind: "project", cwd: "C:/projects/selected", name: "Selected" },
			}),
		);

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("only once"));
		await act(async () => {
			const first = result.current.actions?.send();
			const second = result.current.actions?.send();
			expect(prepareCwd).toHaveBeenCalledOnce();
			finishPreparing?.("C:/projects/selected");
			await Promise.all([first, second]);
		});

		expect(onSent).toHaveBeenCalledOnce();
	});

	it("mounts the composer before the team catalog finishes loading", async () => {
		let resolveCatalog: ((value: typeof document) => void) | undefined;
		list.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCatalog = resolve;
				}),
		);
		const { result } = renderHook(() => useNewSessionTeamDraft(options()));

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
		const { result } = renderHook(() => useNewSessionTeamDraft(options(onSent)));
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

	it("preserves edits made while a selected project is being prepared", async () => {
		let finishPreparing: ((cwd: string) => void) | undefined;
		prepareCwd.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishPreparing = resolve;
				}),
		);
		const onSent = vi.fn();
		const { result } = renderHook(() =>
			useNewSessionTeamDraft({
				...options(onSent),
				projectSelection: { kind: "project", cwd: "C:/projects/selected", name: "Selected" },
			}),
		);

		await waitFor(() => expect(result.current.actions).not.toBeNull());
		act(() => result.current.actions?.setDraft("already sent"));
		let sending: Promise<void> | undefined;
		act(() => {
			sending = result.current.actions?.send();
		});
		act(() => result.current.actions?.setDraft("next task"));
		await act(async () => {
			finishPreparing?.("C:/projects/selected");
			await sending;
		});

		expect(getDefaultStore().get(inputValueAtom)).toBe("next task");
		expect(takeTeamSessionHandoff(reservedSessionId)).toMatchObject({ text: "already sent" });
		expect(onSent).toHaveBeenCalledWith(reservedSessionId);
	});
});
