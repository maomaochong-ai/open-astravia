/**
 * Cowart storage client — Codex widget bridge OR Astravia host bridge (window.cowartMcp).
 * Adapted for Astravia: hasCowartWidgetBridge() is true when the plugin installs cowartMcp.
 */

const TOOL_GET_CANVAS_STATE = "get_cowart_canvas_state";
const TOOL_SAVE_CANVAS_STATE = "save_cowart_canvas_state";
const TOOL_SAVE_SELECTION_STATE = "save_cowart_selection_state";
const TOOL_SAVE_VIEW_STATE = "save_cowart_view_state";
const TOOL_SAVE_REFERENCE_IMAGE = "save_cowart_reference_image";
const TOOL_READ_PAGE_ASSET = "read_cowart_page_asset";
const TOOL_DOWNLOAD_FILE = "download_cowart_file";
const TOOL_INSERT_HTML_DRAFT = "insert_cowart_html_draft";
const WIDGET_PAYLOAD_TIMEOUT_MS = 5000;

export const IS_COWART_WIDGET_BUILD = true;

export function hasCowartWidgetBridge() {
	return Boolean(window.cowartMcp && typeof window.cowartMcp.callServerTool === "function");
}

function currentWidgetPayload() {
	return window.openai?.toolOutput && typeof window.openai.toolOutput === "object" ? window.openai.toolOutput : {};
}

function hasWidgetStorageTarget() {
	const payload = currentWidgetPayload();
	return Boolean(payload.projectDir || payload.canvasDir);
}

function serverToolArgs(extra = {}) {
	const payload = currentWidgetPayload();
	return removeUndefined({
		projectDir: payload.projectDir,
		canvasDir: payload.canvasDir,
		...extra,
	});
}

function removeUndefined(value) {
	return Object.fromEntries(Object.entries(value).filter(([_key, item]) => item !== undefined));
}

function abortError() {
	return new DOMException("The operation was aborted.", "AbortError");
}

function bridgeReady() {
	return hasCowartWidgetBridge() && hasWidgetStorageTarget();
}

/**
 * Wait until Astravia host installs window.cowartMcp + toolOutput projectDir.
 * Unlike Codex, bridge can briefly disappear during React Strict Mode remount —
 * never call callServerTool until ready again.
 */
async function waitForWidgetPayload(signal) {
	if (bridgeReady()) return;

	await new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}

		const timer = window.setTimeout(() => {
			cleanup();
			reject(
				new Error(
					"Cowart host bridge was not ready (window.cowartMcp / projectDir). Open the canvas again after the plugin loads.",
				),
			);
		}, WIDGET_PAYLOAD_TIMEOUT_MS);
		const poll = window.setInterval(() => {
			if (bridgeReady()) finish();
		}, 40);
		const cleanup = () => {
			window.clearTimeout(timer);
			window.clearInterval(poll);
			window.removeEventListener("openai:set_globals", handleGlobals);
			signal?.removeEventListener("abort", handleAbort);
		};
		const finish = () => {
			cleanup();
			resolve();
		};
		const handleGlobals = () => {
			if (bridgeReady()) finish();
		};
		const handleAbort = () => {
			cleanup();
			reject(abortError());
		};

		window.addEventListener("openai:set_globals", handleGlobals);
		signal?.addEventListener("abort", handleAbort, { once: true });
		if (bridgeReady()) finish();
	});
}

async function callCowartServerTool(name, args = {}, options = {}) {
	await waitForWidgetPayload(options.signal);
	if (options.signal?.aborted) throw abortError();
	const mcp = window.cowartMcp;
	if (!mcp || typeof mcp.callServerTool !== "function") {
		throw new Error("Cowart host bridge missing: window.cowartMcp.callServerTool");
	}
	const result = await mcp.callServerTool({
		name,
		arguments: serverToolArgs(args),
	});
	if (result?.isError) {
		const message = result.content?.find((item) => item.type === "text")?.text;
		throw new Error(message || `Cowart server tool failed: ${name}`);
	}
	return result.structuredContent ?? result;
}

export async function loadCowartCanvasState(signal) {
	const state = await callCowartServerTool(TOOL_GET_CANVAS_STATE, { hydrateAssets: false }, { signal });
	return {
		snapshot: state.snapshot,
		viewState: state.viewState ?? null,
		storage: state.storage,
		skippedRecords: [],
	};
}

export async function refreshCowartCanvasSnapshot(signal) {
	const state = await callCowartServerTool(TOOL_GET_CANVAS_STATE, { hydrateAssets: false }, { signal });
	return state.snapshot;
}

export async function saveCowartCanvasSnapshot(snapshot, options = {}) {
	return callCowartServerTool(TOOL_SAVE_CANVAS_STATE, {
		snapshot,
		protectImageRecords: options.protectImageRecords,
		acknowledgedImageShapeDeletes: options.acknowledgedImageShapeDeletes,
	});
}

export async function saveCowartSelectionState(selection) {
	return callCowartServerTool(TOOL_SAVE_SELECTION_STATE, { selection });
}

export async function saveCowartViewState(viewState) {
	return callCowartServerTool(TOOL_SAVE_VIEW_STATE, { viewState });
}

export async function saveCowartReferenceImage(reference) {
	return callCowartServerTool(TOOL_SAVE_REFERENCE_IMAGE, reference);
}

export async function downloadCowartFile(download) {
	return callCowartServerTool(TOOL_DOWNLOAD_FILE, download);
}

export async function updateCowartHtmlDraft({ draftShapeId, htmlContent }) {
	return callCowartServerTool(TOOL_INSERT_HTML_DRAFT, {
		draftShapeId,
		htmlContent,
		updateExistingDraft: true,
	});
}

export async function readCowartPageAsset(assetUrl, options = {}) {
	return callCowartServerTool(TOOL_READ_PAGE_ASSET, { assetUrl }, options);
}
