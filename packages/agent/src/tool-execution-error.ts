export interface AgentToolExecutionErrorDetails {
	readonly code: string;
	readonly retryable: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export class AgentToolExecutionError extends Error {
	readonly details: AgentToolExecutionErrorDetails;

	constructor(message: string, details: AgentToolExecutionErrorDetails, options?: ErrorOptions) {
		super(message, options);
		this.name = "AgentToolExecutionError";
		this.details = Object.freeze({
			...details,
			metadata: details.metadata ? Object.freeze({ ...details.metadata }) : undefined,
		});
	}
}
