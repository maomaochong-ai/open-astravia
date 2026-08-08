export interface CodingToolResultArtifactWriteRequest {
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly mediaType: "application/json";
	readonly data: string;
	readonly byteLength: number;
}

export interface CodingToolResultArtifact {
	readonly reference: string;
}

export interface CodingToolResultArtifactStore {
	write(request: CodingToolResultArtifactWriteRequest): Promise<CodingToolResultArtifact>;
}
