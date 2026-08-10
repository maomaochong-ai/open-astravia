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
	// 托管 Node 运行时的 npm 配置（RuntimeManager.applyEnv 写在主进程 process.env 上）。
	// 不带上这几个键，插件里的 `npm install` 就会绕过配置的镜像源与共享缓存，回落到
	// 默认 registry —— vetta-ui-design 的设计引擎首次装依赖会因此慢上数倍。
	"npm_config_registry",
	"npm_config_cache",
	"npm_config_prefix",
	"npm_config_userconfig",
	"NPM_CONFIG_USERCONFIG",
] as const;

export function createPluginCommandEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const key of INHERITED_ENV_KEYS) {
		const value = process.env[key];
		if (value !== undefined) environment[key] = value;
	}
	return { ...environment, ...overrides };
}
