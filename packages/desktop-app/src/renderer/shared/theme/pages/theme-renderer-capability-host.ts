import { rendererCapabilityHost } from "@shared/capabilities/renderer-capability-host";
import type { CapabilityAccessSessionFactory } from "@vetta/capability-sdk";
import {
	createThemeRendererHostedRouteSession,
	type ThemeRendererHostedRouteSession,
} from "./theme-hosted-route-capability.js";

interface ActiveThemeRendererSession {
	readonly generation: symbol;
	readonly session: ThemeRendererHostedRouteSession;
}

export class ThemeRendererCapabilityHost {
	private active: ActiveThemeRendererSession | undefined;

	constructor(private readonly accessSessionFactory: CapabilityAccessSessionFactory = rendererCapabilityHost) {}

	activate(themeId: string): { dispose(): void } {
		this.active?.session.revoke();
		this.active = undefined;
		const generation = Symbol(themeId);
		const session = createThemeRendererHostedRouteSession(
			this.accessSessionFactory,
			globalThis.crypto.randomUUID(),
			themeId,
		);
		this.active = { generation, session };
		return {
			dispose: () => {
				if (this.active?.generation !== generation) return;
				session.revoke();
				this.active = undefined;
			},
		};
	}

	openPage(themeId: string, pageId: string): Promise<void> {
		const session = this.active?.session;
		if (!session || session.themeId !== themeId) {
			return Promise.reject(new Error("Theme renderer capability session is not active"));
		}
		return session.openPage(pageId);
	}
}

export const themeRendererCapabilityHost = new ThemeRendererCapabilityHost();
