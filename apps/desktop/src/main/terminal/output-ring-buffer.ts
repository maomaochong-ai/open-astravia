/**
 * 终端输出的尾部缓冲。
 *
 * 作用只有一个：渲染进程重新挂载（切 tab、展开面板、reload）时能把断连期间的输出补上。
 * 它不是历史记录——真正的回滚历史在 xterm 自己的 scrollback 与会话快照里，所以这里
 * 只保尾部若干字节，超了就丢最旧的并记一个截断标记，让补发时能如实告知「前面省略了」。
 *
 * 按整块丢而不是按字节切：PTY 的 chunk 是 UTF-16 字符串，从中间切会切断代理对，
 * 补发时就会出现乱码方块。宁可比上限多留一点。
 */
export class OutputRingBuffer {
	private chunks: string[] = [];
	private size = 0;
	private truncated = false;

	constructor(private readonly limit: number) {}

	push(chunk: string): void {
		if (!chunk) return;
		this.chunks.push(chunk);
		this.size += chunk.length;
		while (this.size > this.limit && this.chunks.length > 1) {
			const dropped = this.chunks.shift();
			this.size -= dropped?.length ?? 0;
			this.truncated = true;
		}
	}

	/** 补发用的完整尾部内容。 */
	read(): string {
		return this.chunks.join("");
	}

	/** 是否已经丢过内容；补发时据此提示用户前面有省略。 */
	isTruncated(): boolean {
		return this.truncated;
	}

	get length(): number {
		return this.size;
	}

	clear(): void {
		this.chunks = [];
		this.size = 0;
		this.truncated = false;
	}
}
