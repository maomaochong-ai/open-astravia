import type { ChatConversationItem } from "@shared/store/atoms";
import type { Usage } from "@vetta/ai/protocol";

/** User-message identity that drives model-switch banners; ignores streaming assistant ticks. */
export function userModelSwitchFingerprint(messages: readonly ChatConversationItem[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.kind !== "user") continue;
		parts.push(message.id, message.model?.provider ?? "", message.model?.id ?? "");
	}
	return parts.join("\0");
}

export function collectModelSwitchLabels(
	messages: readonly ChatConversationItem[],
	modelLabels: ReadonlyMap<string, string>,
): Map<string, ModelSwitchLabel> {
	const switches = new Map<string, ModelSwitchLabel>();
	let previousKey: string | null = null;
	for (const message of messages) {
		if (message.kind !== "user") continue;
		const key = message.model ? `${message.model.provider}/${message.model.id}` : null;
		if (key && previousKey && key !== previousKey) {
			switches.set(message.id, {
				from: modelLabels.get(previousKey) ?? previousKey,
				to: modelLabels.get(key) ?? key,
			});
		}
		if (key) previousKey = key;
	}
	return switches;
}

export interface ModelSwitchLabel {
	readonly from: string;
	readonly to: string;
}

/**
 * All model-call usages of the session. Returns `previous` when nothing changed:
 * every assistant row receives this list, so a new array on each streamed delta
 * would re-render all of them although usage only grows once per model call.
 */
export function collectAgentUsages(
	messages: readonly ChatConversationItem[],
	previous?: readonly Usage[],
): readonly Usage[] {
	const usages: Usage[] = [];
	for (const message of messages) {
		if (message.kind === "agent" && message.usages) usages.push(...message.usages);
	}
	if (previous && previous.length === usages.length && previous.every((usage, index) => usage === usages[index])) {
		return previous;
	}
	return usages;
}
