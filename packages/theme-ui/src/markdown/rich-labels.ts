export interface RichContentLabels {
	preview: string;
	source: string;
	run: string;
	stop: string;
	waiting: string;
	paused: string;
	tooLarge: string;
	failed: string;
	staticHtml: string;
	running: string;
	svg: string;
	html: string;
	loading?: string;
	retry?: string;
	enlarge?: string;
	save?: string;
	diagram?: string;
	imageFailed?: string;
	actionFailed?: string;
}

export const defaultRichContentLabels: RichContentLabels = {
	preview: "Preview",
	source: "Source",
	run: "Run JavaScript",
	stop: "Stop",
	waiting: "Preview will appear when generation finishes.",
	paused: "Preview paused. Run again to restart the page.",
	tooLarge: "This content is too large to preview. You can still view and copy its source.",
	failed: "Could not render this content. Its source is shown instead.",
	staticHtml: "Static preview. Run JavaScript to enable interactions; external resources are blocked.",
	running: "Interactive preview. Automatically stops after 30 seconds.",
	svg: "SVG preview",
	html: "HTML preview",
	loading: "Loading preview…",
	retry: "Retry",
	enlarge: "Enlarge",
	save: "Save",
	diagram: "Diagram",
	imageFailed: "Could not load image.",
	actionFailed: "Could not complete this action. Try again.",
};

export interface MarkdownLabels {
	copy: string;
	copied: string;
	rich?: RichContentLabels;
}
