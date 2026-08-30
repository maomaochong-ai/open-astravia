export type DesktopMcpElicitationValue = string | number | boolean | string[];

export interface DesktopMcpElicitationOption {
	readonly value: string;
	readonly label: string;
}

export interface DesktopMcpElicitationField {
	readonly key: string;
	readonly kind: "string" | "number" | "integer" | "boolean" | "single-select" | "multi-select";
	readonly title: string;
	readonly description?: string;
	readonly required: boolean;
	readonly defaultValue?: DesktopMcpElicitationValue;
	readonly format?: "email" | "uri" | "date" | "date-time";
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly options?: readonly DesktopMcpElicitationOption[];
}

export type DesktopMcpElicitationRequest =
	| {
			readonly requestId: string;
			readonly sessionId: string;
			readonly serverName: string;
			readonly mode: "form";
			readonly message: string;
			readonly fields: readonly DesktopMcpElicitationField[];
	  }
	| {
			readonly requestId: string;
			readonly sessionId: string;
			readonly serverName: string;
			readonly mode: "url";
			readonly message: string;
			readonly url: string;
	  };

export interface DesktopMcpElicitationResponse {
	readonly action: "accept" | "decline" | "cancel";
	readonly content?: Readonly<Record<string, DesktopMcpElicitationValue>>;
}

export interface DesktopMcpElicitationResolvedEvent {
	readonly requestId: string;
	readonly sessionId: string;
}
