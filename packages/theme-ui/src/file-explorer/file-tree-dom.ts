/** Attribute on the `role="tree"` container carrying its `rootDir`; hosts use it to focus the right tree. */
export const FILE_TREE_ROOT_ATTR = "data-file-tree-root";

/**
 * Locate the mounted file tree for `rootDir`. Keyboard focus lives on this
 * container (rows are virtualized and not focusable), so hosts that want to hand
 * focus to the tree focus the element returned here.
 */
export function findFileTreeElement(rootDir: string, doc: Document = document): HTMLElement | null {
	for (const candidate of doc.querySelectorAll<HTMLElement>(`[role="tree"][${FILE_TREE_ROOT_ATTR}]`)) {
		if (candidate.getAttribute(FILE_TREE_ROOT_ATTR) === rootDir) return candidate;
	}
	return null;
}

/** Stable DOM id for the row at `index`, used by `aria-activedescendant`. */
export function fileTreeRowDomId(treeId: string, index: number): string {
	return `${treeId}-row-${index}`;
}

export function isFileTreeEditableTarget(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("input,textarea,[contenteditable=true]") !== null;
}
