import { app } from "electron";
import { getAppLogger } from "../../logger.js";

const DEFAULT_RENDERER_CDP_PORT = 9223;
const RENDERER_CDP_HOST = "127.0.0.1";

const log = getAppLogger("debug-ui-cdp");

export type RendererCdpConfiguration =
	| {
			configured: false;
			reason: "cli_mode" | "disabled" | "invalid_port" | "not_development" | "packaged";
	  }
	| {
			configured: true;
			host: typeof RENDERER_CDP_HOST;
			port: number;
			endpoint: string;
	  };

export interface ConfigureRendererCdpOptions {
	isCliMode: boolean;
	isPackaged: boolean;
	devServerUrl?: string;
	portValue?: string;
}

function parsePort(value: string | undefined): number | null {
	if (value === undefined || value.trim() === "") return DEFAULT_RENDERER_CDP_PORT;
	const port = Number(value);
	return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export function configureRendererCdp(options: ConfigureRendererCdpOptions): RendererCdpConfiguration {
	if (options.isPackaged) return { configured: false, reason: "packaged" };
	if (options.isCliMode) return { configured: false, reason: "cli_mode" };
	if (!options.devServerUrl) return { configured: false, reason: "not_development" };

	const requestedValue = options.portValue?.trim().toLowerCase();
	if (requestedValue === "off" || requestedValue === "false" || requestedValue === "0") {
		log.info("renderer CDP disabled by environment");
		return { configured: false, reason: "disabled" };
	}

	const port = parsePort(options.portValue);
	if (port === null) {
		log.warn("renderer CDP disabled: invalid VETTA_DEBUG_CDP_PORT", { value: options.portValue });
		return { configured: false, reason: "invalid_port" };
	}

	app.commandLine.appendSwitch("remote-debugging-address", RENDERER_CDP_HOST);
	app.commandLine.appendSwitch("remote-debugging-port", String(port));
	const endpoint = `http://${RENDERER_CDP_HOST}:${port}`;
	log.info("renderer CDP configured", { endpoint });
	return { configured: true, host: RENDERER_CDP_HOST, port, endpoint };
}
