const AUTHORIZATION_PATTERN = /(bearer\s+)[a-z0-9._~+/=-]+/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi;
const SENSITIVE_QUERY_PATTERN =
	/([?&](?:access_token|api_key|apikey|authorization|refresh_token|secret|token)=)[^&#\s]+/gi;

export function redactSensitiveText(value: string): string {
	return value
		.replace(AUTHORIZATION_PATTERN, "$1[redacted]")
		.replace(JWT_PATTERN, "[redacted-jwt]")
		.replace(SENSITIVE_QUERY_PATTERN, "$1[redacted]")
		.replace(EMAIL_PATTERN, "[redacted-email]");
}

export function redactUrl(value: string | undefined): string | undefined {
	if (!value) return value;
	try {
		const url = new URL(value);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return redactSensitiveText(value.split("?")[0] ?? value);
	}
}
