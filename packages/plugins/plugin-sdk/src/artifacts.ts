export interface PluginArtifactRef {
	id: string;
	mimeType: string;
	sizeBytes: number;
	lifetime: "temporary";
	name?: string;
}

export type PluginArtifactDestination =
	| { type: "plugin-blob"; blobId?: string }
	| { type: "workspace-file"; path: string };

export type PluginPersistedArtifact =
	| {
			type: "plugin-blob";
			blobId: string;
			url: string;
			mimeType: string;
			sizeBytes: number;
	  }
	| {
			type: "workspace-file";
			path: string;
			mimeType: string;
			sizeBytes: number;
	  };

export interface PluginArtifactsApi {
	persist(
		artifact: PluginArtifactRef | string,
		destination: PluginArtifactDestination,
	): Promise<PluginPersistedArtifact>;
	release(artifact: PluginArtifactRef | string): Promise<void>;
}
