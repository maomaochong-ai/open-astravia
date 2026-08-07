const INHERITED_ENV_KEYS = [
	"PATH",
	"Path",
	"PATHEXT",
	"SystemRoot",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"TEMP",
	"TMP",
	"TMPDIR",
	"HOME",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"LANG",
	"LC_ALL",
	"TERM",
	"NO_COLOR",
] as const;

export function createPluginCommandEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of INHERITED_ENV_KEYS) {
		const value = process.env[key];
		if (value !== undefined) environment[key] = value;
	}
	return { ...environment, ...overrides };
}
