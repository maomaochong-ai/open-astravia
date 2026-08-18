import type { DesktopActionApprovalRequest, DesktopActionJsonValue } from "@preload/api.js";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import {
	actionApprovalStateAtom,
	beginActionApprovalResponseAtom,
	completeActionApprovalResponseAtom,
	failActionApprovalResponseAtom,
	GENERIC_ACTION_APPROVAL_PRESENTATION,
	registerActionApprovalPresenterAtom,
} from "../store/action-approval-atoms";
import { type ApprovalCountdownState, useApprovalCountdown } from "./useApprovalCountdown";

export interface ActiveActionApproval {
	request: DesktopActionApprovalRequest;
	responding: boolean;
	error: string | null;
	countdown: ApprovalCountdownState;
	approve: (input?: DesktopActionJsonValue) => void;
	reject: () => void;
}

export function useActionApproval(presentation: string): ActiveActionApproval | null {
	const state = useAtomValue(actionApprovalStateAtom);
	const registerPresenter = useSetAtom(registerActionApprovalPresenterAtom);
	const beginResponse = useSetAtom(beginActionApprovalResponseAtom);
	const completeResponse = useSetAtom(completeActionApprovalResponseAtom);
	const failResponse = useSetAtom(failActionApprovalResponseAtom);

	useEffect(() => {
		registerPresenter({ presentation, mounted: true });
		return () => {
			registerPresenter({ presentation, mounted: false });
		};
	}, [presentation, registerPresenter]);

	const request = state.active;
	const requestedPresentation = request?.approvalPresentation ?? GENERIC_ACTION_APPROVAL_PRESENTATION;
	const targetPresentation =
		requestedPresentation !== GENERIC_ACTION_APPROVAL_PRESENTATION &&
		(state.presenterCounts[requestedPresentation] ?? 0) > 0
			? requestedPresentation
			: GENERIC_ACTION_APPROVAL_PRESENTATION;
	const visibleRequest = request && targetPresentation === presentation ? request : undefined;
	const countdown = useApprovalCountdown(visibleRequest?.expiresAt);

	const respond = useCallback(
		(approved: boolean, input?: DesktopActionJsonValue) => {
			if (!request || !beginResponse(request.approvalId)) return;
			void window.vetta.actionApproval
				.respond(request.approvalId, approved, input)
				.then((accepted) => {
					if (!accepted) {
						console.warn(`[action approval] Request is no longer pending: ${request.approvalId}`);
					}
					completeResponse(request.approvalId);
				})
				.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					failResponse({
						approvalId: request.approvalId,
						error: `提交审批结果失败：${message}`,
					});
				});
		},
		[beginResponse, completeResponse, failResponse, request],
	);

	if (!request || targetPresentation !== presentation) return null;

	return {
		request,
		responding: state.responding,
		error: state.error,
		countdown,
		approve: (input) => respond(true, input),
		reject: () => respond(false),
	};
}
