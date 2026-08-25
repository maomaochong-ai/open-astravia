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
