export interface CodingAgentConfigurationValueResolver {
	resolve(value: string): string | undefined;
	resolveHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined;
}

/** Portable fallback for embedded hosts that only use literal configuration values. */
export const literalCodingAgentConfigurationValueResolver: CodingAgentConfigurationValueResolver = Object.freeze({
	resolve: (value: string) => value,
	resolveHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined {
		return headers ? { ...headers } : undefined;
	},
});
