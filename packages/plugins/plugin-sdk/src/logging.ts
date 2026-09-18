export type PluginLogLevel = "debug" | "info" | "warn" | "error";

export type PluginLogFields = Readonly<Record<string, unknown>>;

export interface PluginLogger {
	debug(message: string, fields?: PluginLogFields): void;
	info(message: string, fields?: PluginLogFields): void;
	warn(message: string, fields?: PluginLogFields): void;
	error(message: string, fields?: PluginLogFields): void;
	child(scope: string): PluginLogger;
}

export interface PluginLogIdentity {
	id: string;
	version: string;
}

export interface PluginLogEntry {
	level: PluginLogLevel;
	plugin: PluginLogIdentity;
	scope?: string;
	message: string;
	fields?: PluginLogFields;
}

export type PluginLogSink = (entry: PluginLogEntry) => void;

let pluginLogSink: PluginLogSink | undefined;

/** Host-only: install the sink used by build-bound plugin loggers. */
export function __setPluginLogSink(sink: PluginLogSink | undefined): void {
	pluginLogSink = sink;
}

function joinScope(parent: string | undefined, child: string): string {
	const normalized = child.trim();
	if (!normalized) throw new Error("Plugin logger scope must not be empty");
	return parent ? `${parent}.${normalized}` : normalized;
}

function emit(
	plugin: PluginLogIdentity,
	scope: string | undefined,
	level: PluginLogLevel,
	message: string,
	fields: PluginLogFields | undefined,
): void {
	if (!pluginLogSink) throw new Error("Vetta plugin log sink is not installed");
	pluginLogSink({
		level,
		plugin,
		...(scope ? { scope } : {}),
		message,
		...(fields ? { fields } : {}),
	});
}

/** Build-tool entry point. Plugin authors import the bound facade from `@vetta-org/plugin-sdk/logger`. */
export function __createPluginLogger(plugin: PluginLogIdentity, scope?: string): PluginLogger {
	const identity = Object.freeze({ id: plugin.id, version: plugin.version });
	const write = (level: PluginLogLevel, message: string, fields?: PluginLogFields): void => {
		emit(identity, scope, level, message, fields);
	};
	const logger: PluginLogger = {
		debug: (message, fields) => write("debug", message, fields),
		info: (message, fields) => write("info", message, fields),
		warn: (message, fields) => write("warn", message, fields),
		error: (message, fields) => write("error", message, fields),
		child: (childScope) => __createPluginLogger(identity, joinScope(scope, childScope)),
	};
	return Object.freeze(logger);
}
