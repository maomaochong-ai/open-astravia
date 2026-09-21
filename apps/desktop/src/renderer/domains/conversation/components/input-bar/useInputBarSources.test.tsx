// @vitest-environment jsdom

import { pendingPlanReviewsAtom, pendingQuestionsAtom, sandboxPermissionDrawerAtom } from "@shared/store/atoms";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useInputBarInteractionSource } from "./useInputBarSources";

describe("useInputBarInteractionSource", () => {
	it("only exposes a sandbox request to the owning runtime scope", () => {
		const store = createStore();
		store.set(sandboxPermissionDrawerAtom, {
			requestId: "sandbox-request",
			runtimeId: "team-member-runtime",
			title: "Sandbox access",
			message: "Allow path access",
			onConfirm: vi.fn(),
			onCancel: vi.fn(),
		});
		store.set(pendingQuestionsAtom, {
			"team-member-runtime": {
				requestId: "question-request",
				sessionId: "team-member-runtime",
				questions: [],
			},
		});
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		const ordinaryChat = renderHook(() => useInputBarInteractionSource("ordinary-chat-runtime"), { wrapper });
		const owningTeam = renderHook(
			() => useInputBarInteractionSource(["team-leader-runtime", "team-member-runtime"]),
			{ wrapper },
		);

		expect(ordinaryChat.result.current.sandboxPermission).toBeNull();
		expect(owningTeam.result.current.sandboxPermission).toMatchObject({
			requestId: "sandbox-request",
			runtimeId: "team-member-runtime",
		});
		expect(ordinaryChat.result.current.pendingQuestion).toBeUndefined();
		expect(owningTeam.result.current.pendingQuestion).toMatchObject({ requestId: "question-request" });
	});

	it("hands a pending plan review only to the input bar of the session that submitted it", () => {
		const store = createStore();
		store.set(pendingPlanReviewsAtom, {
			"planning-runtime": { requestId: "review-request", sessionId: "planning-runtime", plan: "1. Ship" },
		});
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		const otherChat = renderHook(() => useInputBarInteractionSource("other-runtime"), { wrapper });
		const planningChat = renderHook(() => useInputBarInteractionSource("planning-runtime"), { wrapper });
		const newSessionPage = renderHook(() => useInputBarInteractionSource(undefined), { wrapper });

		expect(otherChat.result.current.pendingPlanReview).toBeUndefined();
		expect(newSessionPage.result.current.pendingPlanReview).toBeUndefined();
		expect(planningChat.result.current.pendingPlanReview).toMatchObject({ requestId: "review-request" });
	});
});
