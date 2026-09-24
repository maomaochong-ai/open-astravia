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
	modelNames: ReadonlyMap<string, string>,
): Map<string, ModelSwitchLabel> {
	const switches = new Map<string, ModelSwitchLabel>();
	let previousKey: string | null = null;
	for (const message of messages) {
		if (message.kind !== "user") continue;
		const key = message.model ? `${message.model.provider}/${message.model.id}` : null;
		if (key && previousKey && key !== previousKey) {
			switches.set(message.id, {
				from: modelNames.get(previousKey) ?? previousKey,
				to: modelNames.get(key) ?? key,
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

export function collectAgentUsages(messages: readonly ChatConversationItem[]): readonly Usage[] {
	const usages: Usage[] = [];
	for (const message of messages) {
		if (message.kind === "agent" && message.usages) usages.push(...message.usages);
	}
	return usages;
}
