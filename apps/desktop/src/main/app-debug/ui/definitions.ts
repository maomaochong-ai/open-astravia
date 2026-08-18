import { z } from "zod";
import { getMainWindow } from "../../window-manager.js";
import type { DebugDefinition, JsonValue } from "../types.js";
import { DebugError } from "../types.js";
import type { RendererCdpConfiguration } from "./renderer-cdp.js";

const inputSchema = z.object({}).strict();
const cdpTargetSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: z.string(),
	url: z.string(),
});
const cdpTargetsSchema = z.array(cdpTargetSchema);

function validateInput(input: unknown): JsonValue {
	const result = inputSchema.safeParse(input);
	if (!result.success) {
		throw new DebugError("DEBUG_INVALID_INPUT", "ui.info input must be an empty object.", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return result.data;
}

async function inspectCdpEndpoint(configuration: RendererCdpConfiguration, mainWindowUrl: string | null) {
	if (!configuration.configured) {
		return { reachable: false, targetFound: false, target: null };
	}

	try {
		const response = await fetch(`${configuration.endpoint}/json/list`, {
			signal: AbortSignal.timeout(1_500),
		});
		if (!response.ok) return { reachable: false, targetFound: false, target: null };
		const parsedTargets = cdpTargetsSchema.safeParse(await response.json());
		if (!parsedTargets.success) return { reachable: false, targetFound: false, target: null };
		const target = parsedTargets.data.find(
			(candidate) => candidate.type === "page" && candidate.url === mainWindowUrl,
		);
		return {
			reachable: true,
			targetFound: target !== undefined,
			target: target ?? null,
		};
	} catch {
		return { reachable: false, targetFound: false, target: null };
	}
}

export function createUiDebugDefinitions(configuration: RendererCdpConfiguration): DebugDefinition[] {
	return [
		{
			id: "ui.info",
			category: "ui",
			title: "UI automation information",
			summary: "Discover the development Electron renderer CDP endpoint and its main window target.",
			keywords: ["ui", "playwright", "cdp", "electron", "renderer", "automation"],
			inputSchema: { description: "An empty JSON object." },
			examples: [{ description: "Discover the renderer CDP endpoint", input: {} }],
			validateInput,
			run: async () => {
				const mainWindow = getMainWindow();
				const mainWindowUrl = mainWindow?.webContents.getURL() ?? null;
				const inspection = await inspectCdpEndpoint(configuration, mainWindowUrl);
				return {
					configured: configuration.configured,
					reason: configuration.configured ? null : configuration.reason,
					transport: "cdp",
					endpoint: configuration.configured ? configuration.endpoint : null,
					port: configuration.configured ? configuration.port : null,
					mainWindow: {
						available: mainWindow !== null,
						title: mainWindow?.getTitle() ?? null,
						url: mainWindowUrl,
					},
					...inspection,
				};
			},
		},
	];
}
