import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AuthStorageData } from "./contracts.js";

const ApiKeyCredentialSchema = Type.Object(
	{
		type: Type.Literal("api_key"),
		key: Type.String(),
	},
	{ additionalProperties: true },
);

const OAuthCredentialSchema = Type.Object(
	{
		type: Type.Literal("oauth"),
		refresh: Type.String(),
		access: Type.String(),
		expires: Type.Number(),
	},
	{ additionalProperties: true },
);

export const AuthDocumentSchema = Type.Record(
	Type.String(),
	Type.Union([ApiKeyCredentialSchema, OAuthCredentialSchema]),
);

export function parseAuthDocument(content: string | undefined): AuthStorageData {
	if (!content) return {};
	const parsed: unknown = JSON.parse(content);
	if (!Value.Check(AuthDocumentSchema, parsed)) {
		const issue = Value.Errors(AuthDocumentSchema, parsed).First();
		const location = issue?.path ? ` at ${issue.path}` : "";
		const detail = issue?.message ? `: ${issue.message}` : "";
		throw new Error(`Invalid auth credential document${location}${detail}`);
	}
	return parsed as AuthStorageData;
}

export function serializeAuthDocument(data: AuthStorageData): string {
	return JSON.stringify(data, null, 2);
}
