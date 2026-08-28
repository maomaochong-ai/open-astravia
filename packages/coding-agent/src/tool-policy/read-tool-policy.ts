const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const SKILL_DIRECTORY_SEGMENT = "skills";

const BINARY_EXTENSION_SKILLS: Readonly<Record<string, string>> = Object.freeze({
	".doc": "docx",
	".odt": "docx",
	".xls": "xlsx",
	".ods": "xlsx",
	".csv": "xlsx",
	".tsv": "xlsx",
	".ppt": "pptx",
	".odp": "pptx",
});

/** Coding Agent 对通用 Node read 实现叠加的资源完整性与能力引导策略。 */
export interface CodingAgentReadToolOptions {
	readonly preserveFullText: (absolutePath: string) => boolean;
	readonly binaryContentHint: (extension: string) => string;
}

export const CODING_AGENT_READ_TOOL_OPTIONS: CodingAgentReadToolOptions = Object.freeze({
	preserveFullText: isCodingAgentInstructionMarkdown,
	binaryContentHint: codingAgentBinaryContentHint,
});

export function isCodingAgentInstructionMarkdown(absolutePath: string): boolean {
	const segments = foldPathSegments(absolutePath);
	const filename = segments.at(-1) ?? "";
	if (filename === SKILL_MARKDOWN_FILENAME) return true;
	if (!filename.toLowerCase().endsWith(".md")) return false;
	return segments.includes(SKILL_DIRECTORY_SEGMENT);
}

export function codingAgentBinaryContentHint(extension: string): string {
	const skillName = BINARY_EXTENSION_SKILLS[extension] ?? extension.slice(1);
	return skillName
		? `Load the "${skillName}" skill for instructions on how to handle this file.`
		: "No matching skill found. Convert this file with a command tool before reading.";
}

function foldPathSegments(absolutePath: string): string[] {
	const segments: string[] = [];
	for (const segment of absolutePath.split(/[/\\]+/)) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments;
}
