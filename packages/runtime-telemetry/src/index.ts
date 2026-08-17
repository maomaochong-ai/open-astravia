export interface LoggerContext {
	sessionId?: string;
	requestId?: string;
	toolCallId?: string;
	meta?: Record<string, unknown>;
}

export interface RuntimeLogger {
	info(message: string, context?: LoggerContext): void;
	warn(message: string, context?: LoggerContext): void;
	error(message: string, context?: LoggerContext): void;
}

export class ConsoleRuntimeLogger implements RuntimeLogger {
	info(message: string, context?: LoggerContext): void {
		console.info(this.format("info", message, context));
	}

	warn(message: string, context?: LoggerContext): void {
		console.warn(this.format("warn", message, context));
	}

	error(message: string, context?: LoggerContext): void {
		console.error(this.format("error", message, context));
	}

	private format(level: "info" | "warn" | "error", message: string, context?: LoggerContext): string {
		const payload = context ? ` ${JSON.stringify(context)}` : "";
		return `[runtime][${level}] ${message}${payload}`;
	}
}

// Backward-compatible names. The execution-facing observation contract is owned by agent-core.
export type {
	AgentCostDetails as RuntimeCostDetails,
	AgentObservation as RuntimeObservation,
	AgentObservationLevel as RuntimeObservationLevel,
	AgentObservationStartOptions as RuntimeObservationStartOptions,
	AgentObservationType as RuntimeObservationType,
	AgentObservationUpdate as RuntimeObservationUpdate,
	AgentTracer as RuntimeTracer,
	AgentUsageDetails as RuntimeUsageDetails,
} from "@vetta/agent-core";
