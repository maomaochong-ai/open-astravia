import { parseInputSegments } from "./parse";
import { segmentsToText } from "./serialize";
import type { InputSegment } from "./types";

export interface PreparedInputPrompt {
	/** 发给模型的正文。 */
	readonly text: string;
	/** 原始编辑态分段，供 usage/附件等派生逻辑复用。 */
	readonly segments: readonly InputSegment[];
}

function trimEdgeText(segments: readonly InputSegment[]): InputSegment[] {
	const out = segments.map((segment) => ({ ...segment }));
	const first = out[0];
	if (first?.kind === "text") {
		first.text = first.text.trimStart();
		if (first.text === "") out.shift();
	}
	const last = out.at(-1);
	if (last?.kind === "text") {
		last.text = last.text.trimEnd();
		if (last.text === "") out.pop();
	}
	return out;
}

/** 将统一编辑器 Token 投影为 Runtime Prompt 合同。 */
export function prepareInputPrompt(text: string, sourceSegments?: readonly InputSegment[]): PreparedInputPrompt {
	const parsed =
		sourceSegments && segmentsToText(sourceSegments).trim() === text.trim()
			? { segments: trimEdgeText(sourceSegments), legacyRef: null }
			: parseInputSegments(text);
	return { text, segments: parsed.segments };
}
