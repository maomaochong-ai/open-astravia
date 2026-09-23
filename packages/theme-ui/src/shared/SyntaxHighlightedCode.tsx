import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { codeToHtml } from "shiki";

export interface SyntaxHighlightedCodeProps {
	code: string;
	lang: string;
	theme: "light" | "dark";
	/** 字号跟随所在正文的排版尺度；不传时用 12px 的紧凑默认值。 */
	fontSizeClass?: string;
	/**
	 * 流式尾块里的代码仍可能在涨。为 true 时只渲染等宽纯文本，不跑 Shiki。
	 * 围栏稳定或尾块结束后由调用方关掉。
	 */
	live?: boolean;
}

/**
 * 高亮结果缓存。消息列表跑在虚拟列表上，条目滚出视窗会被卸载、滚回来重新挂载；
 * 没有缓存时每次重挂都要重跑一遍 shiki，并且先渲染纯文本、拿到 HTML 再换——
 * 高度变两次，虚拟列表跟着重测量两次，表现为往回滚时卡顿加跳动。
 * 命中缓存时首帧就是高亮结果，只有一次布局。
 */
const HTML_CACHE = new Map<string, string>();
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_UNITS = 4_000_000;
const MAX_ENTRY_UNITS = 256_000;
let cacheUnits = 0;
const VIEWPORT_ROOT_MARGIN = "400px 0px";

function putCache(key: string, html: string): void {
	const previous = HTML_CACHE.get(key);
	if (previous !== undefined) {
		cacheUnits -= key.length + previous.length;
		HTML_CACHE.delete(key);
	}
	while (HTML_CACHE.size >= MAX_CACHE_ENTRIES || cacheUnits + key.length + html.length > MAX_CACHE_UNITS) {
		const oldest = HTML_CACHE.keys().next().value;
		if (oldest === undefined) return;
		cacheUnits -= oldest.length + (HTML_CACHE.get(oldest)?.length ?? 0);
		HTML_CACHE.delete(oldest);
	}
	HTML_CACHE.set(key, html);
	cacheUnits += key.length + html.length;
}

/** Limit grammar work and generated spans; the full source remains readable/copyable. */
function withinHighlightBudget(code: string, lang: string): boolean {
	if (code.length > 30000 || lang.length > 128) return false;
	let lineLength = 0;
	let lines = 1;
	for (const char of code) {
		if (char === "\n") { lineLength = 0; lines++; }
		else lineLength++;
		if (lineLength > 2000 || lines > 1000) return false;
	}
	return true;
}

function cacheKeyFor(theme: string, language: string, code: string): string {
	return JSON.stringify([theme, language, code]);
}

function PlainCode({ code, fontSizeClass }: { code: string; fontSizeClass: string }): JSX.Element {
	return (
		<pre className="overflow-x-auto p-3">
			<code className={`${fontSizeClass} leading-[1.6] text-foreground`}>{code}</code>
		</pre>
	);
}

/**
 * Shiki-highlighted code block. Plain text while loading, offscreen, live, or on error.
 */
export function SyntaxHighlightedCode({
	code,
	lang,
	theme,
	fontSizeClass = "text-[12px]",
	live = false,
}: SyntaxHighlightedCodeProps): JSX.Element {
	const language = lang || "text";
	const eligible = useMemo(() => withinHighlightBudget(code, language), [code, language]);
	const cacheKey = useMemo(() => eligible ? cacheKeyFor(theme, language, code) : "", [eligible, theme, language, code]);
	const html = HTML_CACHE.get(cacheKey) ?? null;
	const hostRef = useRef<HTMLDivElement>(null);
	const [inView, setInView] = useState(html !== null);
	const [, forceRender] = useState(0);

	useEffect(() => {
		if (!eligible || live) return;
		if (HTML_CACHE.has(cacheKey)) {
			setInView(true);
			return;
		}
		const node = hostRef.current;
		if (!node || typeof IntersectionObserver !== "function") {
			setInView(true);
			return;
		}
		let visible = false;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				visible = true;
				setInView(true);
				observer.disconnect();
			},
			{ rootMargin: VIEWPORT_ROOT_MARGIN },
		);
		observer.observe(node);
		return () => {
			observer.disconnect();
			if (!visible) setInView(false);
		};
	}, [cacheKey, eligible, live]);

	useEffect(() => {
		if (live || !eligible || !inView || HTML_CACHE.has(cacheKey)) return;
		let cancelled = false;
		codeToHtml(code, {
			lang: language,
			theme: theme === "dark" ? "github-dark-default" : "github-light-default",
		})
			.then((result) => {
				putCache(cacheKey, result.length <= MAX_ENTRY_UNITS ? result : "");
				if (!cancelled) forceRender((tick) => tick + 1);
			})
			.catch(() => {
				putCache(cacheKey, "");
				if (!cancelled) forceRender((tick) => tick + 1);
			});
		return () => {
			cancelled = true;
		};
	}, [cacheKey, code, eligible, inView, language, live, theme]);

	const showPlain = live || !eligible || html === null || html === "";
	return (
		<div ref={hostRef}>
			{showPlain ? (
				<PlainCode code={code} fontSizeClass={fontSizeClass} />
			) : (
				<div
					className={`overflow-x-auto ${fontSizeClass} leading-[1.6] [&_pre]:!bg-transparent [&_pre]:!p-3 [&_code]:!bg-transparent`}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki generates safe HTML
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			)}
		</div>
	);
}
