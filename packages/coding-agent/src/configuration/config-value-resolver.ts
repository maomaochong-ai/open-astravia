import { execSync } from "node:child_process";

const commandResultCache = new Map<string, string | undefined>();

export function resolveConfigValue(config: string): string | undefined {
	if (config.startsWith("!")) return executeCommand(config);
	return process.env[config] || config;
}

export function resolveConfigHeaders(
	headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const resolvedValue = resolveConfigValue(value);
		if (resolvedValue) resolved[key] = resolvedValue;
	}
	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

export function clearConfigValueCache(): void {
	commandResultCache.clear();
}

function executeCommand(commandConfig: string): string | undefined {
	if (commandResultCache.has(commandConfig)) return commandResultCache.get(commandConfig);

	let result: string | undefined;
	try {
		const output = execSync(commandConfig.slice(1), {
			encoding: "utf-8",
			timeout: 10_000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		result = output.trim() || undefined;
	} catch {
		result = undefined;
	}
	commandResultCache.set(commandConfig, result);
	return result;
}
