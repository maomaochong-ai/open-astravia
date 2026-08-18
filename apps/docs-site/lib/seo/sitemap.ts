import { toAbsoluteUrl } from "../site";

export interface SitemapPageInput {
	path: string;
	lastModified?: string | Date;
}

export interface SitemapEntry {
	url: string;
	lastModified?: Date;
}

export function buildSitemapEntries(pages: SitemapPageInput[], origin?: string): SitemapEntry[] {
	const seen = new Set<string>();
	const entries: SitemapEntry[] = [];

	for (const page of pages) {
		const url = toAbsoluteUrl(page.path, origin);
		if (seen.has(url)) continue;
		seen.add(url);
		const entry: SitemapEntry = { url };
		if (page.lastModified) entry.lastModified = new Date(page.lastModified);
		entries.push(entry);
	}

	return entries.sort((left, right) => left.url.localeCompare(right.url));
}
