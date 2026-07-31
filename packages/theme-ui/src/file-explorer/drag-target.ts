/**
 * Whether a dragleave means the pointer left `currentTarget` entirely.
 * Without this, moving between a parent and its children fires leave and
 * clears drop highlights (flicker).
 */
export function isDragLeavingElement(event: {
	currentTarget: EventTarget;
	relatedTarget: EventTarget | null;
}): boolean {
	const current = event.currentTarget as { contains?: (node: Node) => boolean };
	const related = event.relatedTarget;
	if (typeof current.contains !== "function") return true;
	if (related == null || typeof related !== "object") return true;
	try {
		return !current.contains(related as Node);
	} catch {
		return true;
	}
}

/** Soft drop-target styles (file tree root / empty state). */
export const FILE_TREE_ROOT_DROP_CLASS =
	"rounded-xl bg-primary/5 outline outline-1 outline-dashed outline-primary/25 -outline-offset-1";

/** Soft drop-target styles (directory row). */
export const FILE_TREE_NODE_DROP_CLASS = "bg-primary/8 ring-1 ring-inset ring-primary/20";
