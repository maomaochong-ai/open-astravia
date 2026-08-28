import type { SubagentChildEvent, SubagentChildHandle } from "../../src/index.js";
import { waitUntil } from "./wait.js";

export class TestChild implements SubagentChildHandle {
	readonly sessionFile: string;
	readonly prompts: string[] = [];
	disposeCalls = 0;
	private readonly listeners = new Set<(event: SubagentChildEvent) => void>();
	private streaming = false;
	private finalText: string | undefined;
	private resolvePrompt: (() => void) | undefined;

	constructor(readonly sessionId: string) {
		this.sessionFile = `.subagents/${sessionId}.conversation.jsonl`;
	}

	async prompt(text: string): Promise<void> {
		this.prompts.push(text);
		this.streaming = true;
		this.emit({ type: "agent_start" });
		await new Promise<void>((resolve) => {
			this.resolvePrompt = resolve;
		});
	}

	async sendMessage(): Promise<void> {}

	async followUp(text: string): Promise<void> {
		await this.prompt(text);
	}

	abort(): void {
		this.streaming = false;
		this.resolvePrompt?.();
		this.resolvePrompt = undefined;
	}

	async waitForIdle(): Promise<void> {
		await waitUntil(() => !this.streaming);
	}

	isStreaming(): boolean {
		return this.streaming;
	}

	getLastAssistantText(): string | undefined {
		return this.finalText;
	}

	dispose(): void {
		this.disposeCalls += 1;
		this.abort();
		this.listeners.clear();
	}

	subscribe(listener: (event: SubagentChildEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	complete(text: string): void {
		this.finalText = text;
		this.streaming = false;
		this.emit({ type: "agent_end" });
		this.resolvePrompt?.();
		this.resolvePrompt = undefined;
	}

	private emit(event: SubagentChildEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

export class DelayedAbortChild extends TestChild {
	private readonly idle: Promise<void>;
	private resolveIdle = () => {};

	constructor(sessionId: string) {
		super(sessionId);
		this.idle = new Promise((resolve) => {
			this.resolveIdle = resolve;
		});
	}

	override abort(): void {}

	override waitForIdle(): Promise<void> {
		return this.idle;
	}

	releaseAbort(): void {
		super.abort();
		this.resolveIdle();
	}
}
