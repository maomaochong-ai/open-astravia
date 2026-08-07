import type { ToolCategory } from "./contracts.js";

const TOOL_CATEGORIES: ReadonlySet<string> = new Set<ToolCategory>([
	"core",
	"doc",
	"kb-write",
	"kb-read",
	"agent-control",
	"media",
	"im",
	"memory",
	"external",
]);

/** Normalize extension metadata without coupling callers to a tool adapter. */
export function resolveToolCategory(value: string | undefined): ToolCategory {
	return value !== undefined && TOOL_CATEGORIES.has(value) ? (value as ToolCategory) : "external";
}
