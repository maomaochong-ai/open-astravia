/** Minimal hast-like nodes for the streaming chunk rehype plugin. */
export interface HastText {
	type: "text";
	value: string;
}
export interface HastElement {
	type: "element";
	tagName: string;
	properties?: Record<string, unknown>;
	children: Array<HastText | HastElement>;
}
export interface HastRoot {
	type: "root";
	children: Array<HastText | HastElement>;
}
