import { createCapabilityCatalog } from "./catalog.js";
import { FOUNDATION_FILESYSTEM_CAPABILITIES } from "./foundation/filesystem.js";
import { FOUNDATION_GATEWAY_CAPABILITIES } from "./foundation/gateway.js";
import { FOUNDATION_NETWORK_CAPABILITIES } from "./foundation/network.js";
import { FOUNDATION_STORAGE_CAPABILITIES } from "./foundation/storage.js";

export {
	type FilesystemEntry,
	type FilesystemFileRef,
	type FilesystemMoveInput,
	type FilesystemPathInput,
	type FilesystemReadBinaryFileResult,
	type FilesystemReadFileResult,
	type FilesystemRenameInput,
	type FilesystemStatResult,
	type FilesystemWriteFileInput,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_FILESYSTEM_CAPABILITY_CATALOG,
} from "./foundation/filesystem.js";
export {
	FOUNDATION_GATEWAY_CAPABILITIES,
	FOUNDATION_GATEWAY_CAPABILITY_CATALOG,
	type GatewayRequestInput,
} from "./foundation/gateway.js";
export {
	type CapabilityJsonMap,
	type CapabilityJsonValue,
	parseCapabilityJsonMap,
	parseCapabilityJsonValue,
} from "./foundation/json.js";
export {
	FOUNDATION_NETWORK_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITY_CATALOG,
	type NetworkRequestInput,
} from "./foundation/network.js";
export {
	FOUNDATION_STORAGE_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITY_CATALOG,
	type StorageBlob,
	type StorageBlobPutInput,
	type StorageBlobReadInput,
	type StorageBlobRef,
	type StorageBlobWrite,
	type StorageFileReadInput,
	type StorageFileWriteInput,
	type StorageGetAllInput,
	type StorageJsonReadInput,
	type StorageJsonWriteInput,
	type StorageListInput,
	type StorageRemoveInput,
	type StorageSetInput,
} from "./foundation/storage.js";

export const FOUNDATION_CAPABILITY_CATALOG = createCapabilityCatalog([
	...Object.values(FOUNDATION_FILESYSTEM_CAPABILITIES),
	...Object.values(FOUNDATION_STORAGE_CAPABILITIES),
	...Object.values(FOUNDATION_NETWORK_CAPABILITIES),
	...Object.values(FOUNDATION_GATEWAY_CAPABILITIES),
]);
