import { randomUUID } from "node:crypto";

export type DesktopSessionCreationStage = "sandbox-check" | "resolve-config" | "runtime-create" | "record-agent-mode";

interface SessionCreationTraceLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

export class DesktopSessionCreationTrace {
	readonly interactionId: string;
	private readonly startedAt: number;
	private readonly stages: Partial<Record<DesktopSessionCreationStage, number>> = {};
	private failedStage: DesktopSessionCreationStage | undefined;
	private finished = false;

	constructor(
		private readonly logger: SessionCreationTraceLogger,
		interactionId?: string,
		private readonly now: () => number = () => performance.now(),
	) {
		this.interactionId = interactionId ?? randomUUID();
		this.startedAt = this.now();
	}

	async measure<T>(stage: DesktopSessionCreationStage, operation: () => Promise<T>): Promise<T> {
		const stageStartedAt = this.now();
		try {
			return await operation();
		} catch (error) {
			this.failedStage = stage;
			throw error;
		} finally {
			this.stages[stage] = roundDuration(this.now() - stageStartedAt);
		}
	}

	complete(fields: { sessionId: string; kind: string; source: string }): void {
		this.finish("completed", fields);
	}

	fail(fields: { kind: string; source: string }): void {
		this.finish("failed", fields);
	}

	private finish(status: "completed" | "failed", fields: Record<string, unknown>): void {
		if (this.finished) return;
		this.finished = true;
		const payload = {
			interactionId: this.interactionId,
			status,
			totalDurationMs: roundDuration(this.now() - this.startedAt),
			...(this.failedStage ? { failedStage: this.failedStage } : {}),
			stages: this.stages,
			...fields,
		};
		try {
			if (status === "completed") this.logger.info("session creation trace", payload);
			else this.logger.warn("session creation trace", payload);
		} catch {
			// Diagnostics must never change Session creation behavior.
		}
	}
}

function roundDuration(value: number): number {
	return Math.round(Math.max(0, value) * 10) / 10;
}
