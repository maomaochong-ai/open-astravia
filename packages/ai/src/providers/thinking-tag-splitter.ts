const THINKING_TAGS = [
	{ open: "<thinking>", close: "</thinking>" },
	{ open: "<think>", close: "</think>" },
] as const;

export type ThinkingTagSegment = { kind: "text" | "thinking"; text: string };

/** Longest suffix of `buffer` that is a proper prefix of `tag` (a tag split across two deltas). */
function partialTagSuffixLength(buffer: string, tag: string): number {
	if (tag.length === 0) return 0;
	const max = Math.min(buffer.length, tag.length - 1);
	for (let k = max; k > 0; k--) {
		if (buffer.endsWith(tag.slice(0, k))) return k;
	}
	return 0;
}

/**
 * Some OpenAI-compatible gateways leak reasoning summaries into `delta.content`
 * wrapped in `<thinking>...</thinking>` or `<think>...</think>` tags instead of putting them in
 * `reasoning_content` (observed on astravia-go for GPT models: only the first
 * summary part reaches `reasoning_content`, the rest are inlined as tagged text).
 * Without this the tags render as literal body text.
 *
 * Stripping is only allowed while the message has not produced any real text yet,
 * so a model legitimately writing `<thinking>` inside its answer is left alone.
 */
export class ThinkingTagSplitter {
	private buffer = "";
	private inThinking = false;
	private sawText = false;
	private activeTag: (typeof THINKING_TAGS)[number] | null = null;

	push(delta: string): ThinkingTagSegment[] {
		this.buffer += delta;
		const segments: ThinkingTagSegment[] = [];

		while (this.buffer.length > 0) {
			if (this.inThinking && this.activeTag) {
				const close = this.buffer.indexOf(this.activeTag.close);
				if (close >= 0) {
					this.emit(segments, "thinking", this.buffer.slice(0, close));
					this.buffer = this.buffer.slice(close + this.activeTag.close.length);
					this.inThinking = false;
					this.activeTag = null;
					continue;
				}
				const hold = partialTagSuffixLength(this.buffer, this.activeTag.close);
				this.emit(segments, "thinking", this.buffer.slice(0, this.buffer.length - hold));
				this.buffer = this.buffer.slice(this.buffer.length - hold);
				break;
			}

			if (this.sawText) {
				this.emit(segments, "text", this.buffer);
				this.buffer = "";
				break;
			}

			// Check for any thinking tag (skip empty tags)
			let foundTag: (typeof THINKING_TAGS)[number] | null = null;
			let earliestOpen = this.buffer.length;

			for (const tag of THINKING_TAGS) {
				if (tag.open.length === 0) continue;
				const open = this.buffer.indexOf(tag.open);
				if (open >= 0 && open < earliestOpen) {
					earliestOpen = open;
					foundTag = tag;
				}
			}

			if (foundTag) {
				this.emit(segments, "text", this.buffer.slice(0, earliestOpen));
				if (this.sawText) {
					// Real text preceded the tag: keep the tag verbatim.
					this.emit(segments, "text", foundTag.open);
				} else {
					this.inThinking = true;
					this.activeTag = foundTag;
				}
				this.buffer = this.buffer.slice(earliestOpen + foundTag.open.length);
				continue;
			}

			// Check for partial tags
			let maxHold = 0;
			for (const tag of THINKING_TAGS) {
				if (tag.open.length === 0) continue;
				const hold = partialTagSuffixLength(this.buffer, tag.open);
				if (hold > maxHold) maxHold = hold;
			}
			this.emit(segments, "text", this.buffer.slice(0, this.buffer.length - maxHold));
			this.buffer = this.buffer.slice(this.buffer.length - maxHold);
			break;
		}

		return segments;
	}

	/** Emits whatever is still held back (an unterminated or partial tag) as-is. */
	flush(): ThinkingTagSegment[] {
		const segments: ThinkingTagSegment[] = [];
		this.emit(segments, this.inThinking ? "thinking" : "text", this.buffer);
		this.buffer = "";
		this.activeTag = null;
		return segments;
	}

	private emit(segments: ThinkingTagSegment[], kind: "text" | "thinking", text: string): void {
		if (text.length === 0) return;
		if (kind === "text" && text.trim().length > 0) this.sawText = true;
		const last = segments[segments.length - 1];
		if (last?.kind === kind) last.text += text;
		else segments.push({ kind, text });
	}
}
