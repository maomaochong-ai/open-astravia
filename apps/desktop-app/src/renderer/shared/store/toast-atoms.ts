import { atom, getDefaultStore } from "jotai";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface ToastItem {
	id: string;
	variant: ToastVariant;
	/** Optional bold title rendered above the message. */
	title?: string;
	message: string;
	/** Auto-dismiss delay in ms; 0 keeps it until manually dismissed. */
	durationMs: number;
	/** Optional single action button (e.g. "前往设置"). */
	action?: ToastAction;
}

/** Live toast stack, newest last. Rendered by the global {@link Toaster}. */
export const toastsAtom = atom<ToastItem[]>([]);

export interface ShowToastInput {
	variant?: ToastVariant;
	title?: string;
	message: string;
	durationMs?: number;
	action?: ToastAction;
}

const DEFAULT_DURATION_MS = 4000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Imperatively push a toast onto the global stack. Usable from anywhere
 * (event handlers, plugin gating, IPC callbacks) without a React context.
 * Returns the toast id so callers can dismiss it early.
 */
export function showToast(input: ShowToastInput): string {
	const store = getDefaultStore();
	const id = crypto.randomUUID();
	const durationMs = input.durationMs ?? DEFAULT_DURATION_MS;
	const item: ToastItem = {
		id,
		variant: input.variant ?? "info",
		title: input.title,
		message: input.message,
		durationMs,
		action: input.action,
	};
	store.set(toastsAtom, (prev) => [...prev, item]);
	if (durationMs > 0) {
		timers.set(
			id,
			setTimeout(() => dismissToast(id), durationMs),
		);
	}
	return id;
}

export function dismissToast(id: string): void {
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
	getDefaultStore().set(toastsAtom, (prev) => prev.filter((toast) => toast.id !== id));
}
