import type { AppMonitorEvent } from "../../preload/api-types/app-monitor.js";

export interface ProductEvent {
	name: string;
	properties: Record<string, boolean | number | string>;
}

export function toProductEvent(event: AppMonitorEvent): ProductEvent {
	switch (event.type) {
		case "input.attachments.added":
			return {
				name: "input_attachments_added",
				properties: {
					source: event.source,
					file_count: event.files?.length ?? 0,
					image_count: event.images?.length ?? 0,
				},
			};
		case "input.action.toggled":
			return {
				name: "input_action_toggled",
				properties: {
					action_kind: event.actionKind,
					active: event.active,
				},
			};
		case "input.action.used": {
			const builtinCount = event.actions.filter((action) => action.actionKind === "builtin").length;
			return {
				name: "input_action_used",
				properties: {
					action_count: event.actions.length,
					builtin_count: builtinCount,
					plugin_count: event.actions.length - builtinCount,
				},
			};
		}
		case "input.context.used":
			return {
				name: "input_context_used",
				properties: {
					file_count: event.files?.length ?? 0,
					image_count: event.images?.length ?? 0,
					prompt_ref_kind: event.promptRef?.kind ?? "none",
				},
			};
		case "resource.lifecycle":
			return {
				name: "resource_lifecycle_changed",
				properties: {
					resource_kind: event.resourceKind,
					operation: event.operation,
					source: event.source ?? "unknown",
					system: event.system === true,
					permission_count: event.permissionCount ?? 0,
					command_count: event.commandCount ?? 0,
				},
			};
		case "settings.changed":
			return {
				name: "settings_changed",
				properties: {
					tab: event.tab,
					action: event.action,
					target: event.target,
				},
			};
	}
}
