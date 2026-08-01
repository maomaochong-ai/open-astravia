import type { PluginPromptAttachment } from "@vetta-org/plugin-sdk";
import type { DesignSession } from "../vetd/design-session";
import type { SelectedElementPayload } from "./bridge-client";

/**
 * Build the one-shot prompt attachment for the current canvas selection.
 * The instructions carry the machine context (design paths, frame source file,
 * data-vetd-source exact location, semantic DOM info) so the agent can edit the
 * right spot without re-discovering the project layout.
 */
export function frameAttachment(session: DesignSession, frameId: string, label: string): PluginPromptAttachment {
	const entry = session.manifest.frames.find((frame) => frame.id === frameId);
	return {
		id: `vetd-frame-${frameId}`,
		label,
		icon: "frame",
		instructions: [
			[
				"The user selected a design frame on the Vetta UI Design canvas.",
				`Design manifest: ${session.vetdPath}`,
				`Design sources: ${session.dirPath}`,
				`Frame source file: ${session.dirPath}/${entry?.file ?? `frames/${frameId}.tsx`}`,
				entry ? `Current canvas size: ${entry.width}x${entry.height} (manifest is the current truth for size).` : "",
				"Edit that tsx file directly (shared pieces live in ../components, tokens in ../theme.css).",
				"The canvas hot-reloads on save. Follow the vetta-ui-design skill conventions.",
			]
				.filter(Boolean)
				.join("\n"),
		],
		metadata: { kind: "vetd-frame", frameId, file: entry?.file ?? null },
	};
}

export function domAttachment(
	session: DesignSession,
	frameId: string,
	payload: SelectedElementPayload,
	label: string,
): PluginPromptAttachment {
	const entry = session.manifest.frames.find((frame) => frame.id === frameId);
	const sourceLine = payload.source
		? `Exact source location (from compile-time instrumentation): ${session.dirPath}/${payload.source}`
		: `No instrumented source location — locate it in ${session.dirPath}/${entry?.file ?? `frames/${frameId}.tsx`} via the class list / text below.`;
	return {
		id: `vetd-dom-${frameId}`,
		label,
		icon: "crosshair",
		instructions: [
			[
				"The user selected a specific DOM element inside a design frame on the Vetta UI Design canvas and wants targeted changes to it.",
				`Design sources: ${session.dirPath}`,
				`Frame: ${frameId} (${session.dirPath}/${entry?.file ?? `frames/${frameId}.tsx`})`,
				sourceLine,
				`Element: <${payload.tag}>`,
				`DOM path: ${payload.domPath}`,
				payload.classes ? `Classes: ${payload.classes}` : "Classes: (none)",
				payload.text ? `Text content: ${JSON.stringify(payload.text)}` : "",
				`Rendered size: ${Math.round(payload.rect.width)}x${Math.round(payload.rect.height)}`,
				"Note: the element may live in an extracted component under ../components — follow the source location first.",
				"The canvas hot-reloads on save.",
			]
				.filter(Boolean)
				.join("\n"),
		],
		metadata: { kind: "vetd-dom", frameId, source: payload.source, domPath: payload.domPath },
	};
}

export function themeTokenAttachment(session: DesignSession, token: string, label: string): PluginPromptAttachment {
	return {
		id: `vetd-token-${token}`,
		label,
		icon: "palette",
		instructions: [
			[
				`The user selected the design color token --color-${token} from the shared theme.`,
				`Theme file: ${session.dirPath}/theme.css (Tailwind v4 @theme block; all frames share it).`,
				"If asked to change it, edit the token value there — every frame updates via hot reload.",
			].join("\n"),
		],
		metadata: { kind: "vetd-token", token },
	};
}
