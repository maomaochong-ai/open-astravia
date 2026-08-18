export function parseImAgentModelKey(modelKey: string, reasoningLevel?: string) {
	const slash = modelKey.indexOf("/");
	if (slash <= 0 || slash === modelKey.length - 1) {
		throw new Error("IM agent model key must use the provider/model format");
	}
	return {
		provider: modelKey.slice(0, slash),
		model: modelKey.slice(slash + 1),
		...(reasoningLevel ? { reasoningLevel } : {}),
	};
}
