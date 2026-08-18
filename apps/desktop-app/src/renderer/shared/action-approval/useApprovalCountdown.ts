import { useEffect, useState } from "react";

export interface ApprovalCountdownState {
	formatted: string;
	isTimedOut: boolean;
	remainingSeconds: number;
}

function getRemainingSeconds(expiresAt: number | undefined): number {
	if (!expiresAt) return 0;
	return Math.ceil(Math.max(0, expiresAt - Date.now()) / 1000);
}

export function useApprovalCountdown(expiresAt: number | undefined): ApprovalCountdownState {
	const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingSeconds(expiresAt));
	const currentRemainingSeconds = getRemainingSeconds(expiresAt);
	const displayedRemainingSeconds =
		expiresAt && currentRemainingSeconds !== remainingSeconds ? currentRemainingSeconds : remainingSeconds;

	useEffect(() => {
		if (!expiresAt) {
			setRemainingSeconds(0);
			return;
		}

		let timeoutId: ReturnType<typeof setTimeout>;
		const update = (): void => {
			const seconds = getRemainingSeconds(expiresAt);
			setRemainingSeconds(seconds);
			if (seconds === 0) return;

			const remainingMs = Math.max(0, expiresAt - Date.now());
			const untilNextSecond = remainingMs - (seconds - 1) * 1000;
			timeoutId = setTimeout(update, Math.max(1, untilNextSecond));
		};
		update();
		return () => clearTimeout(timeoutId);
	}, [expiresAt]);

	const minutes = Math.floor(displayedRemainingSeconds / 60);
	const seconds = displayedRemainingSeconds % 60;
	return {
		formatted: `${minutes}:${seconds.toString().padStart(2, "0")}`,
		isTimedOut: displayedRemainingSeconds === 0,
		remainingSeconds: displayedRemainingSeconds,
	};
}
