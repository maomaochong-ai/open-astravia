import type { PetBubbleNotice, PetCommand } from "../../shared/pet-ipc.js";
import { mainT } from "../i18n/index.js";

export function createPetBubbleCommand(notice: PetBubbleNotice, sessionId?: string): PetCommand | null {
	const text =
		notice.body?.trim() ||
		(notice.messageKey
			? mainT(`pet:${notice.messageKey}`, notice.params ? { ...notice.params } : undefined)
			: notice.text?.trim());
	if (!text) return null;

	const resolvedNotice: PetBubbleNotice = {
		...notice,
		text,
		...(sessionId === undefined ? {} : { sessionId }),
	};
	return {
		type: "show-bubble",
		text,
		notice: resolvedNotice,
		source: "app",
	};
}
