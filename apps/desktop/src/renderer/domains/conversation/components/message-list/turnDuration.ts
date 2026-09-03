import type { TFunction } from "i18next";

export interface TurnDurationParts {
	hours: number;
	minutes: number;
	seconds: number;
}

export function splitTurnDuration(seconds: number): TurnDurationParts {
	const totalSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
	return {
		hours: Math.floor(totalSeconds / 3600),
		minutes: Math.floor((totalSeconds % 3600) / 60),
		seconds: totalSeconds % 60,
	};
}

export function formatTurnDuration(seconds: number, t: TFunction<"chat">): string {
	const parts = splitTurnDuration(seconds);
	if (parts.hours > 0) {
		return t("messageList.duration.hours", {
			hours: parts.hours,
			minutes: String(parts.minutes).padStart(2, "0"),
		});
	}
	if (parts.minutes > 0) {
		return t("messageList.duration.minutes", {
			minutes: parts.minutes,
			seconds: String(parts.seconds).padStart(2, "0"),
		});
	}
	return t("messageList.duration.seconds", { seconds: parts.seconds });
}
