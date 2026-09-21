import type { PluginFileExplorerEntry, PluginFileIconAssociations, PluginFileIconTheme } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";

export function resolveFileIconTheme(
	theme: PluginFileIconTheme,
	entry: PluginFileExplorerEntry,
	expanded: boolean,
	mode: "light" | "dark" | "highContrast",
): ReactNode {
	const variant = theme[mode];
	const associations: PluginFileIconAssociations = { ...theme, ...variant };
	for (const key of ["fileNames", "fileExtensions", "folderNames", "folderNamesExpanded"] as const) {
		associations[key] = { ...theme[key], ...variant?.[key] };
	}
	const name = entry.name.toLowerCase();
	let id: string | undefined;
	if (entry.isDirectory) {
		id =
			(expanded ? associations.folderNamesExpanded?.[name] : undefined) ??
			associations.folderNames?.[name] ??
			(expanded ? associations.folderExpanded : undefined) ??
			associations.folder;
	} else {
		id = associations.fileNames?.[name];
		// First dot wins for compound suffixes: d.ts is more specific than ts.
		for (let dot = name.indexOf("."); !id && dot >= 0; dot = name.indexOf(".", dot + 1)) {
			id = associations.fileExtensions?.[name.slice(dot + 1)];
		}
		id ??= associations.file;
	}
	return id && Object.hasOwn(theme.iconDefinitions, id) ? theme.iconDefinitions[id] : undefined;
}
