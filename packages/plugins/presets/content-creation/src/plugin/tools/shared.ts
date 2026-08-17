export const CONTENT_WORKSPACE_TAB_ID = "workspace";
export const CONTENT_TOOL_SCOPE_USE = ["conversation", "project"] as const;

export interface ContentProjectInput {
	projectDir?: string;
}

export const CONTENT_PROJECT_DIR_PROPERTY = {
	type: "string",
	description: "Optional absolute project directory. Defaults to the active conversation cwd.",
} as const;

export const CONTENT_REVISION_PROPERTY = {
	type: "number",
	description:
		"Current project revision returned by content_creation_inspect. Include it to reject concurrent changes instead of overwriting newer state.",
} as const;

export function resolveContentProjectCwd(input: ContentProjectInput, sessionCwd: string): string {
	return input.projectDir?.trim() || sessionCwd;
}
