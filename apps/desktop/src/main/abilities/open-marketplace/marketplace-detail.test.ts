import { describe, expect, it } from "vitest";
import type { OpenMarketplaceDetail } from "../../../preload/api-types/abilities.js";
import { mergeMarketplaceDetail } from "./marketplace-detail";

describe("mergeMarketplaceDetail", () => {
	it("combines fields within a locale without changing either source", () => {
		const catalog: OpenMarketplaceDetail = {
			name: "Default name",
			i18n: { zh: { name: "中文名称", description: "中文简介" }, ja: { name: "サンプル" } },
		};
		const presentation: OpenMarketplaceDetail = {
			content: "English detail",
			i18n: { zh: { blocks: [{ type: "hero", title: "中文详情" }] }, en: { name: "English name" } },
		};
		const originals = structuredClone({ catalog, presentation });
		expect(mergeMarketplaceDetail(catalog, presentation)).toEqual({
			name: "Default name",
			content: "English detail",
			i18n: {
				zh: { name: "中文名称", description: "中文简介", blocks: [{ type: "hero", title: "中文详情" }] },
				ja: { name: "サンプル" },
				en: { name: "English name" },
			},
		});
		expect({ catalog, presentation }).toEqual(originals);
	});

	it("ignores missing resolved fields but honors explicit strings and whole-array replacements", () => {
		const catalog: OpenMarketplaceDetail = {
			content: "Default content",
			blocks: [{ type: "hero", title: "Catalog hero" }],
			i18n: {
				zh: {
					name: "旧名称",
					content: "旧正文",
					blocks: [{ type: "hero", title: "旧标题" }],
					meta: [{ label: "来源", value: "目录" }],
				},
			},
		};
		expect(
			mergeMarketplaceDetail(catalog, {
				content: "",
				blocks: undefined,
				i18n: { zh: { name: "新名称", content: "", blocks: [], meta: undefined } },
			}),
		).toEqual({
			content: "",
			blocks: catalog.blocks,
			i18n: { zh: { name: "新名称", content: "", blocks: [], meta: [{ label: "来源", value: "目录" }] } },
		});
	});

	it("keeps catalog-only and presentation-only translations", () => {
		const detail = { i18n: { "zh-CN": { name: "中文名称" } } };
		expect(mergeMarketplaceDetail(detail, {})).toEqual(detail);
		expect(mergeMarketplaceDetail({}, detail)).toEqual(detail);
		expect(mergeMarketplaceDetail({}, {})).toEqual({ i18n: {} });
	});
});
