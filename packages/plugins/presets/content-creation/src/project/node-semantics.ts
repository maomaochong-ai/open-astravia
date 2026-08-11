import type { ContentNodeKind } from "./types";

const DEFAULT_NODE_PURPOSES: Record<ContentNodeKind, string> = {
	prompt: "Provide reusable instructions for generation nodes.",
	"image-generator": "Generate an image from prompt and image references.",
	"video-generator": "Generate a video from prompt and media references.",
	asset: "Collect reusable image, video, and audio assets.",
	output: "Represent a final workflow deliverable.",
};

export function getDefaultNodePurpose(kind: ContentNodeKind): string {
	return DEFAULT_NODE_PURPOSES[kind];
}
