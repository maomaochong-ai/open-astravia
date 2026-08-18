import type { TelemetryContext } from "../../shared/telemetry.js";

export interface DesktopTelemetryApi {
	setContext(context: TelemetryContext): void;
}
