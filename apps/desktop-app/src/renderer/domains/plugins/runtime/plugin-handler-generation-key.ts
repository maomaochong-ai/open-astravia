/** Stable Renderer routing key; activation keeps same-id handler generations physically distinct. */
export function pluginHandlerGenerationKey(pluginId: string, handlerId: string, activationId?: string): string {
	return `${pluginId}:${handlerId}:${activationId ?? "legacy"}`;
}
