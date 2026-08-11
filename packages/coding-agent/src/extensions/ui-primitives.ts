/**
 * Minimal structural UI types exposed to Coding Agent extensions.
 *
 * The TUI product was removed and its package deleted. The extension API still
 * carries a UI surface (widgets / header / footer / editor / custom renderers,
 * autocomplete). That surface is not dead: the RPC host forwards setWidget /
 * setHeader / setFooter to the desktop app for rendering, and HTML export calls
 * `Component.render(width)` to turn a tool's custom renderer into ANSI lines.
 *
 * These aliases keep that contract type-checking without depending on the
 * deleted package. They are intentionally loose — every shipping host either
 * forwards the opaque factory unchanged (RPC → desktop) or only consumes
 * `Component.render`.
 */

/** A renderable unit. Only `render` is consumed by surviving code (HTML export). */
export interface Component {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate?(): void;
	dispose?(): void;
}

/** Opaque terminal-UI host handle passed to extension UI factories. */
export type TUI = unknown;

/** Opaque editor component returned by `setEditorComponent` factories. */
export type EditorComponent = unknown;

/** Opaque editor theme passed to `setEditorComponent` factories. */
export type EditorTheme = unknown;

/** Handle for a shown overlay. */
export type OverlayHandle = unknown;

/** Options for a shown overlay. */
export type OverlayOptions = Record<string, unknown>;

/** An autocomplete suggestion item. */
export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}
