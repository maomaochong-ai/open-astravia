export interface ContentCanvasKeybindings {
	selectAll: string;
	deleteSelection: string;
	deleteSelectionAlternative: string;
}

export const DEFAULT_CONTENT_CANVAS_KEYBINDINGS: Readonly<ContentCanvasKeybindings> = {
	selectAll: "mod+a",
	deleteSelection: "delete",
	deleteSelectionAlternative: "backspace",
};
