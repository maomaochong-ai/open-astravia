import { isDeepStrictEqual } from "node:util";
import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import type { ConversationContextProjector } from "@vetta/runtime-core/kernel";

interface ConversationContextOverlay {
	readonly source: readonly RuntimeMessageEnvelope[];
	readonly targetSeed: readonly RuntimeMessageEnvelope[];
}

/**
 * 为 Extension fork 的 skipConversationRestore 保留执行上下文。
 *
 * 目标 Conversation 仍按 fork 结果持久化；只有模型可见的活动分支投影会在目标
 * seed 前缀保持不变期间，用源 Session 的执行上下文替换该 seed。
 */
export class CodingAgentConversationContextOverlay implements ConversationContextProjector {
	private readonly overlays = new Map<string, ConversationContextOverlay>();

	constructor(private readonly delegate: ConversationContextProjector) {}

	preserve(
		targetSessionId: string,
		source: readonly RuntimeMessageEnvelope[],
		targetSeed: readonly RuntimeMessageEnvelope[],
	): void {
		this.overlays.set(targetSessionId, {
			source: Object.freeze([...source]),
			targetSeed: Object.freeze([...targetSeed]),
		});
	}

	clear(sessionId: string): void {
		this.overlays.delete(sessionId);
	}

	clearAll(): void {
		this.overlays.clear();
	}

	project(document: ConversationDocument): readonly RuntimeMessageEnvelope[] {
		const projected = this.delegate.project(document);
		const overlay = this.overlays.get(document.identity.sessionId);
		if (!overlay) return projected;
		if (!hasPrefix(projected, overlay.targetSeed)) {
			this.overlays.delete(document.identity.sessionId);
			return projected;
		}
		return Object.freeze([...overlay.source, ...projected.slice(overlay.targetSeed.length)]);
	}
}

function hasPrefix(values: readonly RuntimeMessageEnvelope[], prefix: readonly RuntimeMessageEnvelope[]): boolean {
	return prefix.length <= values.length && prefix.every((value, index) => isDeepStrictEqual(value, values[index]));
}
