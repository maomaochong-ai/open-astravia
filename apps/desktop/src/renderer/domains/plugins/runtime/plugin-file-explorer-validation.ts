import type {
	PluginFileExplorerDecoration,
	PluginFileExplorerWhen,
	PluginFileIconAssociations,
	PluginFileIconTheme,
} from "@vetta-org/plugin-sdk";
import { isValidElement } from "react";

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected file explorer contribution object");
	return value as Record<string, unknown>;
}

export function validateFileExplorerWhen(value: unknown): PluginFileExplorerWhen | undefined {
	if (value === undefined) return undefined;
	const source = record(value);
	if (source.resourceType !== undefined && source.resourceType !== "file" && source.resourceType !== "directory")
		throw new Error("Invalid resource type");
	for (const key of ["extensions", "fileNames"] as const) {
		const items = source[key];
		if (
			items !== undefined &&
			(!Array.isArray(items) || !items.every((item) => typeof item === "string" && item.length > 0))
		)
			throw new Error(`Invalid ${key}`);
	}
	return {
		resourceType: source.resourceType as PluginFileExplorerWhen["resourceType"],
		extensions: source.extensions ? [...(source.extensions as string[])] : undefined,
		fileNames: source.fileNames ? [...(source.fileNames as string[])] : undefined,
	};
}

function validIcon(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint" ||
		(Array.isArray(value) && value.every(validIcon)) ||
		isValidElement(value)
	);
}

export function validateFileExplorerDecoration(value: unknown): PluginFileExplorerDecoration | null {
	if (value == null) return null;
	const source = record(value);
	if (!validIcon(source.icon)) throw new Error("Invalid file decoration icon");
	for (const key of ["badge", "tooltip"] as const) {
		if (source[key] !== undefined && typeof source[key] !== "string") throw new Error(`Invalid decoration ${key}`);
	}
	for (const key of ["propagate", "faded", "strikethrough"] as const) {
		if (source[key] !== undefined && typeof source[key] !== "boolean") throw new Error(`Invalid decoration ${key}`);
	}
	if (
		source.color !== undefined &&
		(typeof source.color !== "string" ||
			!["foreground", "muted", "accent", "success", "warning", "error"].includes(source.color))
	)
		throw new Error("Invalid decoration color");
	return {
		icon: source.icon as PluginFileExplorerDecoration["icon"],
		badge: source.badge as string | undefined,
		tooltip: source.tooltip as string | undefined,
		color: source.color as PluginFileExplorerDecoration["color"],
		propagate: source.propagate as boolean | undefined,
		faded: source.faded as boolean | undefined,
		strikethrough: source.strikethrough as boolean | undefined,
	};
}

export function validateFileIconTheme(value: unknown): PluginFileIconTheme {
	const source = record(value);
	if (typeof source.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(source.id))
		throw new Error("Invalid file icon theme id");
	if (typeof source.label !== "string" || !source.label.trim()) throw new Error("File icon theme label is required");
	const definitions = record(source.iconDefinitions);
	for (const icon of Object.values(definitions)) if (!validIcon(icon)) throw new Error("Invalid file icon definition");
	function reference(value: unknown): string {
		if (typeof value !== "string" || !Object.hasOwn(definitions, value))
			throw new Error("Unknown file icon definition");
		return value;
	}
	function associations(value: unknown): PluginFileIconAssociations {
		const input = record(value);
		const result: PluginFileIconAssociations = {};
		for (const key of ["file", "folder", "folderExpanded"] as const)
			if (input[key] !== undefined) result[key] = reference(input[key]);
		for (const key of ["fileNames", "fileExtensions", "folderNames", "folderNamesExpanded"] as const) {
			if (input[key] !== undefined)
				result[key] = Object.fromEntries(
					Object.entries(record(input[key])).map(([name, id]) => [name.toLowerCase(), reference(id)]),
				);
		}
		return result;
	}
	return {
		...associations(source),
		id: source.id,
		label: source.label.trim(),
		iconDefinitions: { ...definitions } as PluginFileIconTheme["iconDefinitions"],
		light: source.light === undefined ? undefined : associations(source.light),
		dark: source.dark === undefined ? undefined : associations(source.dark),
		highContrast: source.highContrast === undefined ? undefined : associations(source.highContrast),
	};
}
