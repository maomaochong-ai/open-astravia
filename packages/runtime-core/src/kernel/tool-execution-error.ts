export interface RuntimeToolExecutionErrorDetails {
	readonly code: string;
	readonly retryable: boolean;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export class RuntimeToolExecutionError extends Error {
	readonly details: RuntimeToolExecutionErrorDetails;

	constructor(message: string, details: RuntimeToolExecutionErrorDetails, options?: ErrorOptions) {
		super(message, options);
		this.name = "RuntimeToolExecutionError";
		this.details = Object.freeze({
			...details,
			metadata: details.metadata ? Object.freeze({ ...details.metadata }) : undefined,
		});
	}
}
