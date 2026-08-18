export const USER_ACTIVITY_CHANNEL = "vetta:app-monitor:user-activity";
export const USER_ACTIVITY_THROTTLE_MS = 15_000;

export interface UserActivityReporter {
	readonly report: () => void;
}

export function createUserActivityReporter(
	send: () => void,
	options: { now?: () => number; throttleMs?: number } = {},
): UserActivityReporter {
	const now = options.now ?? Date.now;
	const throttleMs = options.throttleMs ?? USER_ACTIVITY_THROTTLE_MS;
	let lastSentAt = Number.NEGATIVE_INFINITY;

	return {
		report: () => {
			const current = now();
			if (current - lastSentAt < throttleMs) return;
			lastSentAt = current;
			send();
		},
	};
}
