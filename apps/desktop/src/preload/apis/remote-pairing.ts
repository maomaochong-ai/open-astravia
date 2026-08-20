import type { IpcRenderer } from "electron";
import type { RemotePairingApi } from "../api-types/remote-pairing.js";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke">): RemotePairingApi {
	return {
		getState: () => ipc.invoke("vetta:remote-pairing:get-state"),
		create: (relayBaseUrl) => ipc.invoke("vetta:remote-pairing:create", relayBaseUrl),
		setInputEnabled: (enabled) => ipc.invoke("vetta:remote-pairing:set-input-enabled", enabled),
		revoke: () => ipc.invoke("vetta:remote-pairing:revoke"),
	};
}
