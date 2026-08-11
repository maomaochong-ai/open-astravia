export function migrateSettingsDocument(source: Record<string, unknown>): Record<string, unknown> {
	const settings = structuredClone(source);

	if ("queueMode" in settings && !("steeringMode" in settings)) {
		settings.steeringMode = settings.queueMode;
		delete settings.queueMode;
	}

	if (!("transport" in settings) && typeof settings.websockets === "boolean") {
		settings.transport = settings.websockets ? "websocket" : "sse";
		delete settings.websockets;
	}

	if (isLegacySkillsSettings(settings.skills)) {
		if (settings.skills.enableSkillCommands !== undefined && settings.enableSkillCommands === undefined) {
			settings.enableSkillCommands = settings.skills.enableSkillCommands;
		}
		settings.skills =
			Array.isArray(settings.skills.customDirectories) && settings.skills.customDirectories.length > 0
				? settings.skills.customDirectories
				: undefined;
		if (settings.skills === undefined) delete settings.skills;
	}

	return settings;
}

function isLegacySkillsSettings(value: unknown): value is {
	enableSkillCommands?: boolean;
	customDirectories?: unknown;
} {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
