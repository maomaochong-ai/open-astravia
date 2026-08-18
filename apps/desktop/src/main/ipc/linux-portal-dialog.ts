import { fileURLToPath } from "node:url";
import { type ClientInterface, type MessageBus, sessionBus, Variant } from "dbus-next";

const PORTAL_BUS_NAME = "org.freedesktop.portal.Desktop";
const PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop";
const FILE_CHOOSER_INTERFACE = "org.freedesktop.portal.FileChooser";
const REQUEST_INTERFACE = "org.freedesktop.portal.Request";
const PORTAL_RESPONSE_SUCCESS = 0;
const PORTAL_RESPONSE_CANCELLED = 1;
const PORTAL_RESPONSE_ENDED = 2;
const PORTAL_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

interface PortalFileChooserInterface extends ClientInterface {
	OpenFile(parentWindow: string, title: string, options: PortalOptions): Promise<string>;
}

interface PortalRequestInterface extends ClientInterface {
	Close(): Promise<void>;
	on(event: "Response", listener: (response: number, results: PortalResponseResults) => void): this;
	off(event: "Response", listener: (response: number, results: PortalResponseResults) => void): this;
}

type PortalOptions = Record<string, Variant<boolean | string>>;
type PortalResponseResults = Record<string, Variant<unknown>>;

function createHandleToken(): string {
	return `vetta_select_folders_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function extractFilePaths(results: PortalResponseResults): string[] {
	const uris = results.uris;
	if (!uris || !Array.isArray(uris.value)) return [];
	return uris.value.filter((uri): uri is string => typeof uri === "string").map((uri) => fileURLToPath(uri));
}

async function waitForPortalResponse(bus: MessageBus, requestPath: string): Promise<string[]> {
	const requestObject = await bus.getProxyObject(PORTAL_BUS_NAME, requestPath);
	const request = requestObject.getInterface<PortalRequestInterface>(REQUEST_INTERFACE);

	return await new Promise<string[]>((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			request.off("Response", onResponse);
			clearTimeout(timeout);
		};
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const timeout = setTimeout(() => {
			settle(() => {
				void request.Close().catch(() => undefined);
				reject(new Error("Timed out waiting for xdg-desktop-portal file chooser response"));
			});
		}, PORTAL_RESPONSE_TIMEOUT_MS);
		const onResponse = (response: number, results: PortalResponseResults) => {
			settle(() => {
				if (response === PORTAL_RESPONSE_SUCCESS) {
					resolve(extractFilePaths(results));
					return;
				}
				if (response === PORTAL_RESPONSE_CANCELLED || response === PORTAL_RESPONSE_ENDED) {
					resolve([]);
					return;
				}
				reject(new Error(`xdg-desktop-portal file chooser failed with response ${response}`));
			});
		};
		request.on("Response", onResponse);
	});
}

export async function selectFoldersWithLinuxPortal(): Promise<string[]> {
	const bus = sessionBus();
	try {
		const portalObject = await bus.getProxyObject(PORTAL_BUS_NAME, PORTAL_OBJECT_PATH);
		const fileChooser = portalObject.getInterface<PortalFileChooserInterface>(FILE_CHOOSER_INTERFACE);
		const requestPath = await fileChooser.OpenFile("", "Select Folders", {
			directory: new Variant("b", true),
			multiple: new Variant("b", true),
			modal: new Variant("b", true),
			handle_token: new Variant("s", createHandleToken()),
		});
		return await waitForPortalResponse(bus, requestPath);
	} finally {
		bus.disconnect();
	}
}
