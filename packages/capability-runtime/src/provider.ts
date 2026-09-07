import type {
	AnyCapabilityToken,
	CapabilityExecutionContext,
	CapabilityHandler,
	CapabilityToken,
} from "@vetta/capability-sdk";

export interface CapabilityProviderBinding {
	readonly token: AnyCapabilityToken;
	execute(input: unknown, context: CapabilityExecutionContext<unknown>): Promise<unknown>;
}

export function bindCapability<Input, Output, Event = never>(
	token: CapabilityToken<Input, Output, Event>,
	handler: CapabilityHandler<Input, Output, Event>,
): CapabilityProviderBinding {
	return {
		token,
		async execute(value, context) {
			const input = token.parseInput(value);
			const emit = context.emit;
			const output = await handler.execute(input, {
				...context,
				...(emit === undefined
					? {}
					: {
							emit: (event: Event) => {
								if (token.parseEvent === undefined) {
									throw new Error(`Capability ${token.id} does not declare an event contract`);
								}
								emit(token.parseEvent(event));
							},
						}),
			});
			return token.parseOutput(output);
		},
	};
}
