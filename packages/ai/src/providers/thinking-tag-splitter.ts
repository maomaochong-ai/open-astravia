const OPEN_TAG = "<thinking>";
const CLOSE_TAG = "</thinking>";

export type ThinkingTagSegment = { kind: "text" | "thinking"; text: string };

/** Longest suffix of `buffer` that is a proper prefix of `tag` (a tag split across two deltas). */
function partialTagSuffixLength(buffer: string, tag: string): number {
	const max = Math.min(buffer.length, tag.length - 1);
	for (let k = max; k > 0; k--) {
		if (buffer.endsWith(tag.slice(0, k))) return k;
	}
	return 0;
}

/**
 * Some OpenAI-compatible gateways leak reasoning summaries into `delta.content`
 * wrapped in `<thinking>...</thinking>` instead of putting them in
 * `reasoning_content` (observed on vetta-go for GPT models: only the first
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

	push(delta: string): ThinkingTagSegment[] {
		this.buffer += delta;
		const segments: ThinkingTagSegment[] = [];

		while (this.buffer.length > 0) {
			if (this.inThinking) {
				const close = this.buffer.indexOf(CLOSE_TAG);
				if (close >= 0) {
					this.emit(segments, "thinking", this.buffer.slice(0, close));
					this.buffer = this.buffer.slice(close + CLOSE_TAG.length);
					this.inThinking = false;
					continue;
				}
				const hold = partialTagSuffixLength(this.buffer, CLOSE_TAG);
				this.emit(segments, "thinking", this.buffer.slice(0, this.buffer.length - hold));
				this.buffer = this.buffer.slice(this.buffer.length - hold);
				break;
			}

			if (this.sawText) {
				this.emit(segments, "text", this.buffer);
				this.buffer = "";
				break;
			}

			const open = this.buffer.indexOf(OPEN_TAG);
			if (open >= 0) {
				this.emit(segments, "text", this.buffer.slice(0, open));
				if (this.sawText) {
					// Real text preceded the tag: keep the tag verbatim.
					this.emit(segments, "text", OPEN_TAG);
				} else {
					this.inThinking = true;
				}
				this.buffer = this.buffer.slice(open + OPEN_TAG.length);
				continue;
			}

			const hold = partialTagSuffixLength(this.buffer, OPEN_TAG);
			this.emit(segments, "text", this.buffer.slice(0, this.buffer.length - hold));
			this.buffer = this.buffer.slice(this.buffer.length - hold);
			break;
		}

		return segments;
	}

	/** Emits whatever is still held back (an unterminated or partial tag) as-is. */
	flush(): ThinkingTagSegment[] {
		const segments: ThinkingTagSegment[] = [];
		this.emit(segments, this.inThinking ? "thinking" : "text", this.buffer);
		this.buffer = "";
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
