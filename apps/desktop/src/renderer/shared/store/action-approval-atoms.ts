import type { DesktopActionApprovalRequest } from "@preload/api.js";
import { atom } from "jotai";

export const GENERIC_ACTION_APPROVAL_PRESENTATION = "generic";

interface ActionApprovalState {
	active: DesktopActionApprovalRequest | null;
	queue: DesktopActionApprovalRequest[];
	presenterCounts: Record<string, number>;
	responding: boolean;
	error: string | null;
}

const initialState: ActionApprovalState = {
	active: null,
	queue: [],
	presenterCounts: {},
	responding: false,
	error: null,
};

export const actionApprovalStateAtom = atom<ActionApprovalState>(initialState);

export const enqueueActionApprovalAtom = atom(null, (get, set, request: DesktopActionApprovalRequest) => {
	const state = get(actionApprovalStateAtom);
	if (state.active?.approvalId === request.approvalId) return;
	if (state.queue.some((queued) => queued.approvalId === request.approvalId)) return;

	if (state.active === null) {
		set(actionApprovalStateAtom, {
			...state,
			active: request,
			error: null,
		});
		return;
	}

	set(actionApprovalStateAtom, {
		...state,
		queue: [...state.queue, request],
	});
});

export const registerActionApprovalPresenterAtom = atom(
	null,
	(get, set, update: { presentation: string; mounted: boolean }) => {
		const state = get(actionApprovalStateAtom);
		const currentCount = state.presenterCounts[update.presentation] ?? 0;
		const nextCount = Math.max(0, currentCount + (update.mounted ? 1 : -1));
		const presenterCounts = { ...state.presenterCounts };
		if (nextCount === 0) {
			delete presenterCounts[update.presentation];
		} else {
			presenterCounts[update.presentation] = nextCount;
		}
		set(actionApprovalStateAtom, { ...state, presenterCounts });
	},
);

export const beginActionApprovalResponseAtom = atom(null, (get, set, approvalId: string): boolean => {
	const state = get(actionApprovalStateAtom);
	if (state.active?.approvalId !== approvalId || state.responding) return false;
	set(actionApprovalStateAtom, {
		...state,
		responding: true,
		error: null,
	});
	return true;
});

export const completeActionApprovalResponseAtom = atom(null, (get, set, approvalId: string) => {
	const state = get(actionApprovalStateAtom);
	if (state.active?.approvalId !== approvalId) return;
	const [next, ...queue] = state.queue;
	set(actionApprovalStateAtom, {
		...state,
		active: next ?? null,
		queue,
		responding: false,
		error: null,
	});
});

export const autoRejectActionApprovalAtom = atom(null, (get, set, approvalId: string) => {
	const state = get(actionApprovalStateAtom);
	if (state.active?.approvalId === approvalId) {
		const [next, ...queue] = state.queue;
		set(actionApprovalStateAtom, {
			...state,
			active: next ?? null,
			queue,
			responding: false,
			error: null,
		});
		return;
	}

	const queue = state.queue.filter((request) => request.approvalId !== approvalId);
	if (queue.length === state.queue.length) return;
	set(actionApprovalStateAtom, {
		...state,
		queue,
	});
});

export const failActionApprovalResponseAtom = atom(null, (get, set, update: { approvalId: string; error: string }) => {
	const state = get(actionApprovalStateAtom);
	if (state.active?.approvalId !== update.approvalId) return;
	set(actionApprovalStateAtom, {
		...state,
		responding: false,
		error: update.error,
	});
});
