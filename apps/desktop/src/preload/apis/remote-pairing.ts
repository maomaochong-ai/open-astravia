import type { IpcRenderer } from "electron";
import type { RemotePairingApi } from "../api-types/remote-pairing.js";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke">): RemotePairingApi {
	return {
		getState: () => ipc.invoke("vetta:remote-pairing:get-state"),
		createInvite: () => ipc.invoke("vetta:remote-pairing:create-invite"),
		cancelInvite: () => ipc.invoke("vetta:remote-pairing:cancel-invite"),
		setCloudEnabled: (enabled) => ipc.invoke("vetta:remote-pairing:set-cloud-enabled", enabled),
		approve: (id, allow) => ipc.invoke("vetta:remote-pairing:approve", id, allow),
		revokeDevice: (id) => ipc.invoke("vetta:remote-pairing:revoke-device", id),
		renameDevice: (id, name) => ipc.invoke("vetta:remote-pairing:rename-device", id, name),
	};
}
