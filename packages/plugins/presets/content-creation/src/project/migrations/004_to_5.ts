import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const contentProjectMigration004To5: VersionedConfigMigration = {
	fromVersion: 4,
	toVersion: 5,
	migrate(config) {
		const nodes = Array.isArray(config.nodes) ? config.nodes : [];
		return {
			...config,
			schemaVersion: 5,
			nodes: nodes.map((value) => {
				if (!isRecord(value) || value.type !== "video-generator") return value;
				const inputs = isRecord(value.inputs) ? value.inputs : {};
				const { startImages: _startImages, referenceVideos: _referenceVideos, ...restInputs } = inputs;
				return {
					...value,
					inputs: {
						...restInputs,
						mediaSources: [
							...(Array.isArray(inputs.startImages) ? inputs.startImages : []),
							...(Array.isArray(inputs.referenceVideos) ? inputs.referenceVideos : []),
						],
					},
				};
			}),
		};
	},
};
