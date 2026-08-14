export interface ContentCanvasKeybindings {
	selectAll: string;
	deleteSelection: string;
	deleteSelectionAlternative: string;
	undo: string;
	redo: string;
	redoAlternative: string;
}

export const DEFAULT_CONTENT_CANVAS_KEYBINDINGS: Readonly<ContentCanvasKeybindings> = {
	selectAll: "mod+a",
	deleteSelection: "delete",
	deleteSelectionAlternative: "backspace",
	undo: "mod+z",
	redo: "mod+shift+z",
	redoAlternative: "mod+y",
};
