import type { DesktopMcpAppAttachment, DesktopMcpAppSurface } from "@preload/api";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DesktopMcpAppBridge } from "./mcp-app-bridge";
import { buildMcpAppAllow, buildMcpAppCsp } from "./mcp-app-policy";

const OUTER_PROXY_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; frame-src about: data:"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style><script>(()=>{let view;const send=m=>parent.postMessage(m,'*');addEventListener('message',e=>{if(e.source===parent){const m=e.data;if(m&&m.jsonrpc==='2.0'&&m.method==='ui/notifications/sandbox-resource-ready'){view?.remove();view=document.createElement('iframe');view.sandbox=m.params.sandbox;const allow=m.params.allow;if(allow)view.allow=allow;const esc=String(m.params.csp).replaceAll('&','&amp;').replaceAll('"','&quot;');view.srcdoc='<!doctype html><meta http-equiv="Content-Security-Policy" content="'+esc+'">'+m.params.html;document.body.append(view);return}view?.contentWindow?.postMessage(m,'*');return}if(view&&e.source===view.contentWindow&&!String(e.data?.method??'').startsWith('ui/notifications/sandbox-'))send(e.data)});send({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}})})()</script>`;

export interface McpAppSurfaceProps {
	readonly attachment: DesktopMcpAppAttachment;
	readonly input: Readonly<Record<string, unknown>>;
}

export function McpAppSurface({ attachment, input }: McpAppSurfaceProps): JSX.Element | null {
	const { t, i18n } = useTranslation("chat");
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [surface, setSurface] = useState<DesktopMcpAppSurface>();
	const [height, setHeight] = useState(320);

	useEffect(() => {
		let active = true;
		void window.vetta.session.getMcpAppSurface(attachment.id).then((value) => {
			if (active) setSurface(value);
		});
		return () => {
			active = false;
		};
	}, [attachment.id]);

	useEffect(() => {
		const iframe = iframeRef.current;
		const targetWindow = iframe?.contentWindow;
		if (!surface || !targetWindow) return;
		const post = (message: unknown): void => targetWindow.postMessage(message, "*");
		const bridge = new DesktopMcpAppBridge({
			surface,
			targetWindow,
			input,
			post,
			onSizeChanged: setHeight,
			hostContext: {
				locale: i18n.resolvedLanguage ?? i18n.language,
				theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
			},
		});
		const onMessage = (event: MessageEvent): void => {
			if (event.source !== targetWindow || event.origin !== "null") return;
			if (
				event.data?.jsonrpc === "2.0" &&
				event.data?.method === "ui/notifications/sandbox-proxy-ready"
			) {
				post({
					jsonrpc: "2.0",
					method: "ui/notifications/sandbox-resource-ready",
					params: {
						html: surface.resource.html,
						csp: buildMcpAppCsp(surface.resource.meta?.csp),
						sandbox: "allow-scripts allow-forms",
						allow: buildMcpAppAllow(surface.resource.meta, []),
					},
				});
				return;
			}
			bridge.handle(event.data);
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			void Promise.race([
				bridge.requestTeardown("host-unmounted"),
				new Promise((resolve) => setTimeout(resolve, 250)),
			]).finally(() => bridge.close());
			void window.vetta.session.releaseMcpAppSurface(surface.id);
		};
	}, [i18n.language, i18n.resolvedLanguage, input, surface]);

	if (!surface) return null;
	const externalDomainCount = new Set([
		...(surface.resource.meta?.csp?.connectDomains ?? []),
		...(surface.resource.meta?.csp?.resourceDomains ?? []),
		...(surface.resource.meta?.csp?.frameDomains ?? []),
		...(surface.resource.meta?.csp?.baseUriDomains ?? []),
	]).size;
	const requestedPermissions = Object.keys(surface.resource.meta?.permissions ?? {}).length;
	return (
		<div className="mt-2">
			{externalDomainCount > 0 ? (
				<p className="mb-1 text-[10px] text-muted-foreground/60">
					{t("mcpApp.externalAccess", { count: externalDomainCount })}
				</p>
			) : null}
			{requestedPermissions > 0 ? (
				<p className="mb-1 text-[10px] text-muted-foreground/60">{t("mcpApp.permissionsDenied")}</p>
			) : null}
			<iframe
				ref={iframeRef}
				title={t("mcpApp.title")}
				aria-label={t("mcpApp.title")}
				sandbox="allow-scripts allow-same-origin"
				src={`data:text/html;base64,${btoa(OUTER_PROXY_HTML)}`}
				className="w-full rounded-lg border border-border/50 bg-background"
				style={{ height }}
			/>
		</div>
	);
}
