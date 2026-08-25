import type { ImageSettings } from "../settings/contracts/settings-document.js";

/** 旧 Settings 图片字段的只读产品合同；仅供兼容 Adapter 使用。 */
export interface CodingAgentLegacyImageSettingsSource {
	reloadImageSettings?(): void;
	getImageSettings?(): ImageSettings;
	getImageAutoResize?(): boolean;
	getBlockImages?(): boolean;
	getImageRequestHighWatermarkBytes?(): number;
	getImageRequestLowWatermarkBytes?(): number;
}
