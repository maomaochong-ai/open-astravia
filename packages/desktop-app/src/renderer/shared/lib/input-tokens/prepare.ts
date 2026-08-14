import { parseInputSegments } from "./parse";
import { deriveSceneNames, segmentsToText } from "./serialize";
import type { InputSegment } from "./types";

export class MultipleSceneReferencesError extends Error {
	readonly names: readonly string[];

	constructor(names: readonly string[]) {
		super(`Only one Scene can be selected per prompt: ${names.join(", ")}`);
		this.name = "MultipleSceneReferencesError";
		this.names = [...names];
	}
}

export interface PreparedInputPrompt {
	/** 发给模型的正文；scene 编辑态 token 已剥离。 */
	readonly text: string;
	/** 要通过 PromptRequest.promptRef 强制展开的唯一 scene。 */
	readonly sceneName?: string;
	/** 原始编辑态分段，供 usage/附件等派生逻辑复用。 */
	readonly segments: readonly InputSegment[];
}

/** 将统一编辑器 Token 投影为 Runtime Prompt 合同。 */
export function prepareInputPrompt(text: string): PreparedInputPrompt {
	const parsed = parseInputSegments(text);
	const sceneNames = deriveSceneNames(parsed.segments);
	if (parsed.legacyRef?.kind === "scene" && !sceneNames.includes(parsed.legacyRef.name)) {
		sceneNames.unshift(parsed.legacyRef.name);
	}
	if (sceneNames.length > 1) throw new MultipleSceneReferencesError(sceneNames);
	const sceneName = sceneNames[0];
	if (!sceneName) return { text, segments: parsed.segments };

	return {
		text: segmentsToText(parsed.segments.filter((segment) => segment.kind !== "scene")).trim(),
		sceneName,
		segments: parsed.segments,
	};
}
