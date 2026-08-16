import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";
import { loadPromptTemplates, type PromptTemplate } from "../prompts/index.js";

export async function loadPromptResources(options: {
	resourceAccess: ResourceAccessPort;
	cwd: string;
	agentDir: string;
	paths: readonly string[];
	disabled: boolean;
	signal?: AbortSignal;
	override?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
}): Promise<{ prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }> {
	if (options.disabled && options.paths.length === 0) return { prompts: [], diagnostics: [] };
	const prompts = await loadPromptTemplates({
		resourceAccess: options.resourceAccess,
		cwd: options.cwd,
		agentDir: options.agentDir,
		promptPaths: options.paths,
		includeDefaults: false,
		signal: options.signal,
	});
	const seen = new Map<string, PromptTemplate>();
	const diagnostics: ResourceDiagnostic[] = [];
	for (const prompt of prompts) {
		const existing = seen.get(prompt.name);
		if (existing) {
			diagnostics.push({
				type: "collision",
				message: `name "/${prompt.name}" collision`,
				path: prompt.filePath,
				collision: {
					resourceType: "prompt",
					name: prompt.name,
					winnerPath: existing.filePath,
					loserPath: prompt.filePath,
				},
			});
		} else {
			seen.set(prompt.name, prompt);
		}
	}
	const result = { prompts: Array.from(seen.values()), diagnostics };
	return options.override ? options.override(result) : result;
}
