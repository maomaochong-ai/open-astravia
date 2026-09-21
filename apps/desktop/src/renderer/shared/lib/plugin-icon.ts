import { createElement, type ReactNode } from "react";

const ICONIFY_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type ClassifiedPluginIcon =
	| { readonly kind: "class"; readonly value: string }
	| { readonly kind: "image"; readonly url: string };

/**
 * Normalize every plugin icon representation at the renderer boundary.
 *
 * Manifest icons arrive as an Iconify utility, a legacy `set:name` symbol, or
 * an already-resolved image URL. Contribution code should not repeat those
 * string heuristics at each host surface.
 */
export function classifyPluginIcon(icon: string | undefined): ClassifiedPluginIcon | null {
	const trimmed = icon?.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("icon-[")) return { kind: "class", value: trimmed };
	if (ICONIFY_NAME_PATTERN.test(trimmed) && !trimmed.includes("://")) {
		const separator = trimmed.indexOf(":");
		return { kind: "class", value: `icon-[${trimmed.slice(0, separator)}--${trimmed.slice(separator + 1)}]` };
	}
	return { kind: "image", url: trimmed };
}

/** Render a host-resolved plugin icon in ReactNode-based contribution chrome. */
export function resolvePluginIconNode(icon: string | undefined, className = "h-3.5 w-3.5"): ReactNode | undefined {
	const classified = classifyPluginIcon(icon);
	if (!classified) return undefined;
	if (classified.kind === "class") {
		return createElement("span", {
			className: `${classified.value} ${className} shrink-0`,
			"aria-hidden": true,
		});
	}
	return createElement("img", {
		src: classified.url,
		alt: "",
		"aria-hidden": true,
		draggable: false,
		className: `${className} shrink-0 object-contain`,
	});
}

/** Explicit contribution icon wins; only `undefined` inherits the plugin icon. */
export function resolvePluginContributionIcon(
	icon: ReactNode | undefined,
	pluginIcon: string | undefined,
	className?: string,
): ReactNode | undefined {
	return icon === undefined ? resolvePluginIconNode(pluginIcon, className) : icon;
}
