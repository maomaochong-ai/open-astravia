import { useCallback, useEffect, useRef, useState } from "react";

function copyWithTextareaFallback(text: string): boolean {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	textarea.style.top = "0";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		return document.execCommand("copy");
	} finally {
		document.body.removeChild(textarea);
	}
}

export function useCodeClipboard(code: string) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	const markCopied = useCallback(() => {
		setCopied(true);
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => {
			setCopied(false);
			timerRef.current = null;
		}, 1500);
	}, []);

	const copy = useCallback(async () => {
		if (!code) return false;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(code);
			} else if (!copyWithTextareaFallback(code)) {
				return false;
			}
			markCopied();
			return true;
		} catch (err) {
			if (copyWithTextareaFallback(code)) {
				markCopied();
				return true;
			}
			console.warn("[useCodeClipboard] copy failed", err);
			return false;
		}
	}, [code, markCopied]);

	return { copied, copy };
}
