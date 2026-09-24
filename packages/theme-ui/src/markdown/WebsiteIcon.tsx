import { useMarkdownHost } from "./host";
import { useRichVisibility } from "./use-rich-visibility";
import { memo, useEffect, useState } from "react";
import type { JSX } from "react";

const failedIcons = new Map<string, number>();
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILED_ICONS = 128;

function faviconUrl(href: string): string | null {
	try {
		const url = new URL(href);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		// Only request the site's conventional icon, never the page path, query or credentials.
		return `${url.origin}/favicon.ico`;
	} catch {
		return null;
	}
}

function IconImage({ src }: { src: string }): JSX.Element {
	const [status, setStatus] = useState<"loading" | "loaded" | "failed">(() =>
		(failedIcons.get(src) ?? 0) > Date.now() ? "failed" : "loading",
	);
	return (
		<span aria-hidden="true" className="relative inline-block h-3.5 w-3.5 shrink-0 align-text-bottom">
			{status !== "loaded" && <span className="icon-[solar--global-linear] block h-full w-full" />}
			{status !== "failed" && (
				<img
					src={src}
					alt=""
					width={14}
					height={14}
					loading="lazy"
					decoding="async"
					fetchPriority="low"
					referrerPolicy="no-referrer"
					draggable={false}
					className={`absolute inset-0 h-full w-full object-contain ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
					onLoad={() => {
						failedIcons.delete(src);
						setStatus("loaded");
					}}
					onError={() => {
						// Bound negative caching so virtualized history does not repeatedly retry missing icons.
						failedIcons.delete(src);
						failedIcons.set(src, Date.now() + FAILURE_TTL_MS);
						if (failedIcons.size > MAX_FAILED_ICONS) {
							const oldest = failedIcons.keys().next().value;
							if (oldest !== undefined) failedIcons.delete(oldest);
						}
						setStatus("failed");
					}}
				/>
			)}
		</span>
	);
}

/** Decorative leaf shared by chat and file previews; navigation remains owned by the host. */
export const WebsiteIcon = memo(function WebsiteIcon({ href }: { href: string }): JSX.Element | null {
	const fallback = faviconUrl(href);
	const host = useMarkdownHost();
	const { ref, active } = useRichVisibility();
	const [resolved, setResolved] = useState<{ key: string; url: string | null }>();
	useEffect(() => {
		if (!host || !active || !fallback) return;
		let cancelled = false;
		void host.favicon(new URL(fallback).origin).then((url) => {
			if (!cancelled) setResolved({ key: fallback, url });
		}, () => { if (!cancelled) setResolved({ key: fallback, url: null }); });
		return () => { cancelled = true; };
	}, [host, active, fallback]);
	// The host already tried /favicon.ico; do not issue a second, credentialed browser request on failure.
	const src = host ? (resolved?.key === fallback ? resolved.url : null) : fallback;
	return fallback ? <span ref={ref}>{src ? <IconImage key={src} src={src} /> : <span aria-hidden="true" className="icon-[solar--global-linear] inline-block h-3.5 w-3.5 shrink-0" />}</span> : null;
});
