import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcVoidEvent } from "./helper.js";

export function createAbilitiesApi(ipc: IpcRenderer): Pick<DesktopApi, "abilities"> {
	return {
		abilities: {
			getLedger: () => ipc.invoke("vetta:abilities:get-ledger"),
			recordMcpInstall: (runtimeName, version, metadata) =>
				ipc.invoke("vetta:abilities:record-mcp-install", runtimeName, version, metadata),
			listOpenMarketplace: () => ipc.invoke("vetta:abilities:list-open-marketplace"),
			refreshOpenMarketplace: () => ipc.invoke("vetta:abilities:refresh-open-marketplace"),
			listOpenMarketplaces: () => ipc.invoke("vetta:abilities:list-open-marketplaces"),
			refreshOpenMarketplaces: () => ipc.invoke("vetta:abilities:refresh-open-marketplaces"),
			listMarketplaceSources: () => ipc.invoke("vetta:abilities:list-marketplace-sources"),
			addMarketplaceSource: (input) => ipc.invoke("vetta:abilities:add-marketplace-source", input),
			updateMarketplaceSource: (id, input) => ipc.invoke("vetta:abilities:update-marketplace-source", id, input),
			removeMarketplaceSource: (id) => ipc.invoke("vetta:abilities:remove-marketplace-source", id),
			refreshMarketplaceSource: (id) => ipc.invoke("vetta:abilities:refresh-marketplace-source", id),
			onOpenMarketplacesUpdated: (handler) =>
				onIpcVoidEvent(ipc, "vetta:abilities:open-marketplaces-updated", handler),
			installOpenAbility: (type, slug, sourceId) =>
				ipc.invoke("vetta:abilities:install-open-ability", type, slug, sourceId),
		},
	};
}
