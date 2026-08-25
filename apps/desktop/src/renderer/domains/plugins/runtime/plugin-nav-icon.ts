/**
 * Sidebar navigation icons are plain class strings (`SidebarNavItem.icon`), so every
 * theme — including third-party ones — renders them as `<span class={icon} />`.
 *
 * That works for Iconify utilities but leaves plugins that ship their own artwork with
 * no way in. Instead of widening the theme contract, a packaged image is turned into a
 * generated CSS class that masks the image with `currentColor`: the icon still arrives
 * as a class string and still follows the active theme's foreground color, exactly like
 * the built-in navigation entries.
 */

const ICONIFY_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type PluginNavIcon =
	| { readonly kind: "class"; readonly value: string }
	| { readonly kind: "image"; readonly url: string };

/**
 * Classify an icon reference the way the host already classifies plugin manifest icons:
 * a Tailwind Iconify utility, a legacy `set:name` Iconify reference, or an image URL
 * (`vetta-plugin://` / `http(s)://` / `data:`) the host must render itself.
 */
export function classifyPluginNavIcon(icon: string | undefined): PluginNavIcon | null {
	const trimmed = icon?.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("icon-[")) return { kind: "class", value: trimmed };
	if (ICONIFY_NAME_PATTERN.test(trimmed) && !trimmed.includes("://")) {
		const separator = trimmed.indexOf(":");
		return { kind: "class", value: `icon-[${trimmed.slice(0, separator)}--${trimmed.slice(separator + 1)}]` };
	}
	return { kind: "image", url: trimmed };
}

export interface ResolvedNavIcon {
	/** Always set: the class string every theme can render (Iconify or a mask class). */
	className: string;
	/** Set only for an untinted image icon; themes that support it render it in full color. */
	imageUrl?: string;
	/** Drops the generated mask rule, if one was created. */
	release(): void;
}

/**
 * Resolve a navigation icon into what the sidebar contract needs.
 *
 * An image always gets a mask class too, even when it is shown in full color:
 * `SidebarNavItem.icon` stays required, so themes that predate `iconUrl` — or that
 * replace the nav-item component entirely — still render a monochrome version instead
 * of nothing.
 */
export function resolveNavIcon(icon: string | undefined, tint: boolean): ResolvedNavIcon | null {
	const classified = classifyPluginNavIcon(icon);
	if (!classified) return null;
	if (classified.kind === "class") {
		// Iconify utilities are tinted by their own class; there is nothing to opt out of.
		return { className: classified.value, release: () => {} };
	}
	const mask = acquireNavIconClass(classified.url);
	return {
		className: mask.className,
		...(tint ? {} : { imageUrl: classified.url }),
		release: mask.release,
	};
}

/** Stable, CSS-identifier-safe class name for one masked image URL. */
export function navIconClassName(token: number): string {
	return `vetta-plugin-nav-icon-${token}`;
}

export function navIconMaskRule(className: string, url: string): string {
	const value = `url(${JSON.stringify(url)})`;
	return [
		`.${className}{`,
		`background-color:currentColor;`,
		`-webkit-mask-image:${value};mask-image:${value};`,
		`-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;`,
		`-webkit-mask-position:center;mask-position:center;`,
		`-webkit-mask-size:contain;mask-size:contain;`,
		`}`,
	].join("");
}

interface MaskEntry {
	className: string;
	refCount: number;
	style: HTMLStyleElement;
}

const maskEntries = new Map<string, MaskEntry>();
let nextToken = 0;

/**
 * Ensure a mask class exists for `url` and return it. Identical URLs share one rule and
 * one reference count, so re-registering a view (hot reload, re-activation) does not
 * accumulate `<style>` nodes. Call the returned disposer when the contribution goes away.
 */
export function acquireNavIconClass(url: string): { className: string; release: () => void } {
	const existing = maskEntries.get(url);
	if (existing) {
		existing.refCount += 1;
		return { className: existing.className, release: () => releaseNavIconClass(url) };
	}
	nextToken += 1;
	const className = navIconClassName(nextToken);
	const style = document.createElement("style");
	style.dataset.vettaPluginNavIcon = className;
	style.textContent = navIconMaskRule(className, url);
	document.head.append(style);
	maskEntries.set(url, { className, refCount: 1, style });
	return { className, release: () => releaseNavIconClass(url) };
}

function releaseNavIconClass(url: string): void {
	const entry = maskEntries.get(url);
	if (!entry) return;
	entry.refCount -= 1;
	if (entry.refCount > 0) return;
	entry.style.remove();
	maskEntries.delete(url);
}
