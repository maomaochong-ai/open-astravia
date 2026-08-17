/**
 * 模型表单的 API 类型下拉选项：空串=继承服务商，配置里的自定义 api 必须原样保留，
 * 否则用户一打开编辑表单，下拉找不到当前值就会把它改写成别的 api。
 */
import { getApiProviders, registerBuiltInApiProviders } from "@vetta/ai";
import { expect, it } from "vitest";
import { API_OPTIONS, buildModelApiOptions } from "./useModelsSettingsModel";

it("puts the inherit-from-provider option first with an empty value", () => {
	const options = buildModelApiOptions("", "继承服务商");

	expect(options[0]).toEqual({ value: "", label: "继承服务商" });
	expect(options.slice(1)).toEqual(API_OPTIONS);
});

it("keeps a custom api value that is not a built-in option", () => {
	const options = buildModelApiOptions("my-custom-api", "继承服务商");

	expect(options.at(-1)).toEqual({ value: "my-custom-api", label: "my-custom-api" });
	expect(options.filter((option) => option.value === "my-custom-api")).toHaveLength(1);
});

it("does not duplicate a built-in api that is already selected", () => {
	const options = buildModelApiOptions("anthropic-messages", "继承服务商");

	expect(options.filter((option) => option.value === "anthropic-messages")).toHaveLength(1);
	expect(options).toHaveLength(API_OPTIONS.length + 1);
});

it("offers exactly the built-in apis registered by @vetta/ai", () => {
	registerBuiltInApiProviders();
	const registered = getApiProviders()
		.map((provider) => provider.api)
		.sort();

	expect(API_OPTIONS.map((option) => option.value).sort()).toEqual(registered);
});
