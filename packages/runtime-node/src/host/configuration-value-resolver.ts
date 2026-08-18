import { execSync } from "node:child_process";

export interface NodeConfigurationValueResolverOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly commandTimeoutMs?: number;
}

export interface NodeConfigurationValueResolver {
	resolve(value: string): string | undefined;
	resolveHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> | undefined;
	clearCache(): void;
}

/** Resolves literal, environment-backed, and `!command` configuration values for Node hosts. */
export function createNodeConfigurationValueResolver(
	options: NodeConfigurationValueResolverOptions = {},
): NodeConfigurationValueResolver {
	const environment = options.environment ?? process.env;
	const commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
	const commandResultCache = new Map<string, string | undefined>();

	const resolve = (value: string): string | undefined => {
		if (!value.startsWith("!")) return environment[value] || value;
		if (commandResultCache.has(value)) return commandResultCache.get(value);

		let result: string | undefined;
		try {
			const output = execSync(value.slice(1), {
				encoding: "utf-8",
				timeout: commandTimeoutMs,
				stdio: ["ignore", "pipe", "ignore"],
			});
			result = output.trim() || undefined;
		} catch {
			result = undefined;
		}
		commandResultCache.set(value, result);
		return result;
	};

	return {
		resolve,
		resolveHeaders(headers) {
			if (!headers) return undefined;
			const resolved: Record<string, string> = {};
			for (const [key, value] of Object.entries(headers)) {
				const resolvedValue = resolve(value);
				if (resolvedValue) resolved[key] = resolvedValue;
			}
			return Object.keys(resolved).length > 0 ? resolved : undefined;
		},
		clearCache() {
			commandResultCache.clear();
		},
	};
}

export const nodeConfigurationValueResolver = createNodeConfigurationValueResolver();

export function resolveNodeConfigurationValue(value: string): string | undefined {
	return nodeConfigurationValueResolver.resolve(value);
}

export function resolveNodeConfigurationHeaders(
	headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
	return nodeConfigurationValueResolver.resolveHeaders(headers);
}

export function clearNodeConfigurationValueCache(): void {
	nodeConfigurationValueResolver.clearCache();
}
