import type { ResourceAccessPort, ResourceDirectoryEntry, ResourceFileInfo } from "../contracts/resource-access.js";
import { parseFrontmatter } from "../shared/frontmatter.js";
import type { LoadPromptTemplatesOptions, PromptTemplate } from "./contracts.js";

const CONFIG_DIRECTORY = ".vetta";

export async function loadPromptTemplates(options: LoadPromptTemplatesOptions): Promise<PromptTemplate[]> {
	const { resourceAccess: access, cwd, signal } = options;
	const agentDir = options.agentDir ?? access.paths.join(access.paths.homeDirectory(), CONFIG_DIRECTORY, "agent");
	const includeDefaults = options.includeDefaults ?? true;
	const userPromptsDir = access.paths.join(agentDir, "prompts");
	const projectPromptsDir = access.paths.resolve(cwd, CONFIG_DIRECTORY, "prompts");
	const templates: PromptTemplate[] = [];

	if (includeDefaults) {
		templates.push(...(await loadTemplatesFromDirectory(access, userPromptsDir, "user", "(user)", signal)));
		templates.push(...(await loadTemplatesFromDirectory(access, projectPromptsDir, "project", "(project)", signal)));
	}

	for (const rawPath of options.promptPaths ?? []) {
		const resolvedPath = resolvePromptPath(access, rawPath, cwd);
		let info: ResourceFileInfo | undefined;
		try {
			info = await access.files.stat(resolvedPath, { signal });
		} catch {
			signal?.throwIfAborted();
			continue;
		}
		if (!info) continue;
		const { source, label } = sourceInfo(access, resolvedPath, userPromptsDir, projectPromptsDir, includeDefaults);
		if (info.kind === "directory") {
			templates.push(...(await loadTemplatesFromDirectory(access, resolvedPath, source, label, signal)));
		} else if (info.kind === "file" && resolvedPath.endsWith(".md")) {
			const template = await loadTemplateFromFile(access, resolvedPath, source, label, signal);
			if (template) templates.push(template);
		}
	}

	return templates;
}

async function loadTemplatesFromDirectory(
	access: ResourceAccessPort,
	directory: string,
	source: string,
	sourceLabel: string,
	signal?: AbortSignal,
): Promise<PromptTemplate[]> {
	let entries: readonly ResourceDirectoryEntry[];
	try {
		if ((await access.files.stat(directory, { signal }))?.kind !== "directory") return [];
		entries = await access.files.readDirectory(directory, { signal });
	} catch {
		signal?.throwIfAborted();
		return [];
	}

	const templates: PromptTemplate[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		const filePath = access.paths.join(directory, entry.name);
		let isFile = entry.kind === "file";
		if (entry.symbolicLink) {
			try {
				isFile = (await access.files.stat(filePath, { signal }))?.kind === "file";
			} catch {
				signal?.throwIfAborted();
				continue;
			}
		}
		if (!isFile) continue;
		const template = await loadTemplateFromFile(access, filePath, source, sourceLabel, signal);
		if (template) templates.push(template);
	}
	return templates;
}

async function loadTemplateFromFile(
	access: ResourceAccessPort,
	filePath: string,
	source: string,
	sourceLabel: string,
	signal?: AbortSignal,
): Promise<PromptTemplate | undefined> {
	try {
		const rawContent = await access.files.readText(filePath, { signal });
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(rawContent);
		let description = frontmatter.description ?? "";
		if (!description) {
			const firstLine = body.split("\n").find((line) => line.trim());
			if (firstLine) description = `${firstLine.slice(0, 60)}${firstLine.length > 60 ? "..." : ""}`;
		}
		return {
			name: access.paths.basename(filePath).replace(/\.md$/, ""),
			description: description ? `${description} ${sourceLabel}` : sourceLabel,
			content: body,
			source,
			filePath,
		};
	} catch {
		signal?.throwIfAborted();
		return undefined;
	}
}

function resolvePromptPath(access: ResourceAccessPort, input: string, cwd: string): string {
	const trimmed = input.trim();
	const home = access.paths.homeDirectory();
	const normalized =
		trimmed === "~"
			? home
			: trimmed.startsWith("~/") || trimmed.startsWith("~\\")
				? access.paths.join(home, trimmed.slice(2))
				: trimmed.startsWith("~")
					? access.paths.join(home, trimmed.slice(1))
					: trimmed;
	return access.paths.isAbsolute(normalized)
		? access.paths.resolve(normalized)
		: access.paths.resolve(cwd, normalized);
}

function sourceInfo(
	access: ResourceAccessPort,
	resolvedPath: string,
	userPromptsDir: string,
	projectPromptsDir: string,
	includeDefaults: boolean,
): { source: string; label: string } {
	if (!includeDefaults) {
		if (isUnderPath(access, resolvedPath, userPromptsDir)) return { source: "user", label: "(user)" };
		if (isUnderPath(access, resolvedPath, projectPromptsDir)) return { source: "project", label: "(project)" };
	}
	const base = access.paths.basename(resolvedPath).replace(/\.md$/, "") || "path";
	return { source: "path", label: `(path:${base})` };
}

function isUnderPath(access: ResourceAccessPort, target: string, root: string): boolean {
	const resolvedTarget = access.paths.resolve(target);
	const resolvedRoot = access.paths.resolve(root);
	return (
		resolvedTarget === resolvedRoot ||
		resolvedTarget.startsWith(
			resolvedRoot.endsWith(access.paths.separator) ? resolvedRoot : `${resolvedRoot}${access.paths.separator}`,
		)
	);
}
