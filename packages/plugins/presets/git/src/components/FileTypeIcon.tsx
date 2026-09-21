import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";
import { useMemo } from "react";

/** Same icon set the change tree renders, so a file looks identical everywhere. */
const ICON_SET = "complete";
const SPRITE_ELEMENT_ID = "vetta-git-file-icon-sprite";

const resolver = createFileTreeIconResolver({ set: ICON_SET, colored: true });

/**
 * Inject the sprite once into the light DOM.
 *
 * The tree keeps its own copy inside its shadow root, which `<use>` outside that
 * root cannot reference — so surfaces like the turn card need their own.
 */
function ensureSprite(): void {
	if (typeof document === "undefined" || document.getElementById(SPRITE_ELEMENT_ID)) return;
	const host = document.createElement("div");
	host.id = SPRITE_ELEMENT_ID;
	host.setAttribute("aria-hidden", "true");
	host.style.display = "none";
	host.innerHTML = getBuiltInSpriteSheet(ICON_SET);
	document.body.append(host);
}

/**
 * File-type icon for a path, matching the change tree's icons and colours.
 *
 * Colour comes from `data-icon-token` plus the palette mirrored in `style.css`;
 * the tree's own palette lives in its shadow root and is unreachable from here.
 */
export function FileTypeIcon({ path, className }: { path: string; className?: string }): JSX.Element {
	const icon = useMemo(() => {
		ensureSprite();
		return resolver.resolveIcon("file-tree-icon-file", path);
	}, [path]);

	return (
		<svg
			className={`git-file-icon ${className ?? ""}`}
			data-icon-token={icon.token}
			viewBox={icon.viewBox ?? "0 0 16 16"}
			width={icon.width ?? 16}
			height={icon.height ?? 16}
			aria-hidden
		>
			<use href={`#${icon.name}`} />
		</svg>
	);
}
