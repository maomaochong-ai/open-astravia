import type { DefaultTreeAdapterMap } from "parse5";
import { parse } from "parse5";
import { readPublicResource } from "./public-resource.js";

export function discoverIcons(html: string, page: URL): URL[] {
	const icons: string[] = [];
	let base = page;
	let foundBase = false;
	function visit(node: DefaultTreeAdapterMap["node"]): void {
		if ("tagName" in node) {
			const attr = (name: string) => node.attrs.find((item) => item.name === name)?.value;
			const href = attr("href");
			if (node.tagName === "base" && href && !foundBase) {
				foundBase = true;
				try {
					base = new URL(href, page);
				} catch {
					/* Invalid bases are ignored. */
				}
			}
			if (node.tagName === "link" && href && /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attr("rel") ?? ""))
				icons.push(href);
		}
		if ("childNodes" in node) for (const child of node.childNodes) visit(child);
	}
	visit(parse(html));
	const urls: URL[] = [];
	for (const href of icons.slice(0, 3)) {
		try {
			const url = new URL(href, base);
			if (/^https?:$/.test(url.protocol)) urls.push(url);
		} catch {
			/* Malformed icon. */
		}
	}
	urls.push(new URL("/favicon.ico", page));
	return urls;
}

export class FaviconService {
	private readonly lifetime = new AbortController();
	private readonly cache = new Map<string, { value: string | null; expires: number }>();
	private readonly inflight = new Map<string, Promise<string | null>>();
	private active = 0;
	private readonly queue: Array<() => void> = [];
	async resolve(value: string): Promise<string | null> {
		if (this.lifetime.signal.aborted) return null;
		let origin: string;
		try {
			const url = new URL(value);
			if (!/^https?:$/.test(url.protocol)) return null;
			origin = url.origin;
		} catch {
			return null;
		}
		const cached = this.cache.get(origin);
		if (cached && cached.expires > Date.now()) return cached.value;
		const existing = this.inflight.get(origin);
		if (existing) return existing;
		if (this.queue.length >= 64) return null;
		const result = this.fetch(origin)
			.catch(() => null)
			.then((value) => {
				if (this.lifetime.signal.aborted) return null;
				this.cache.delete(origin);
				this.cache.set(origin, { value, expires: Date.now() + (value ? 3_600_000 : 300_000) });
				if (this.cache.size > 64) {
					const oldest = this.cache.keys().next().value;
					if (oldest) this.cache.delete(oldest);
				}
				return value;
			})
			.finally(() => this.inflight.delete(origin));
		this.inflight.set(origin, result);
		return result;
	}
	private async fetch(origin: string): Promise<string | null> {
		if (this.active >= 4) await new Promise<void>((resolve) => this.queue.push(resolve));
		else this.active++;
		try {
			const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]);
			let icons = [new URL("/favicon.ico", origin)];
			try {
				const page = await readPublicResource(new URL(origin), 512_000, signal);
				if (/^text\/html/i.test(page.type)) icons = discoverIcons(page.body.toString("utf8"), page.url);
			} catch {
				/* Conventional icon is the fallback. */
			}
			for (const icon of icons) {
				try {
					const response = await readPublicResource(icon, 128_000, signal);
					const type = response.type.split(";", 1)[0].trim().toLowerCase();
					if (/^image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type))
						return `data:${type};base64,${response.body.toString("base64")}`;
				} catch {
					/* Try the next declared icon. */
				}
			}
			return null;
		} finally {
			const next = this.queue.shift();
			if (next) next();
			else this.active--;
		}
	}
	dispose(): void {
		this.lifetime.abort();
		this.cache.clear();
	}
}
