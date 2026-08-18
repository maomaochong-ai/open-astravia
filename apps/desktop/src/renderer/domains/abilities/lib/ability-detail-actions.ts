/** 详情页壳层的状态与主/次 CTA 推导（纯函数，五种 type 共用）。 */
import type { AbilityItem } from "../types";

export type AbilityStatus = "available" | "setup_required" | "disabled" | "enabled" | "readonly";

export type AbilityPrimaryAction = "add" | "update" | "setup" | "enable" | "none";

export type AbilitySecondaryAction = "disable" | "configure" | "remove";

export function resolveAbilityStatus(item: AbilityItem): AbilityStatus {
	if (item.readonly) return "readonly";
	if (!item.installed) return "available";
	if (item.setupRequired) return "setup_required";
	if (!item.enabled) return "disabled";
	return "enabled";
}

export function resolveAbilityPrimaryAction(item: AbilityItem, status: AbilityStatus): AbilityPrimaryAction {
	if (status === "readonly") return "none";
	if (item.needsUpdate && item.installed) return "update";
	if (status === "available") return "add";
	if (status === "setup_required") return "setup";
	if (status === "disabled") return "enable";
	return "none";
}

export function resolveAbilitySecondaryActions(item: AbilityItem, status: AbilityStatus): AbilitySecondaryAction[] {
	if (status === "readonly" || status === "available") return [];
	const actions: AbilitySecondaryAction[] = [];
	if (status === "enabled") actions.push("disable");
	if (item.type === "mcp" && (item.canConfigure || item.usesOAuth)) actions.push("configure");
	actions.push("remove");
	return actions;
}
