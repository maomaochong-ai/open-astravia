import type { JsonLdGraph } from "@/lib/seo/schema";

export function JsonLd({ data }: { data: JsonLdGraph }) {
	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(data).replaceAll("<", "\\u003c"),
			}}
		/>
	);
}
