import Testing
@testable import VettaKit

@Suite struct ModelChoiceTests {
	let options = [
		RemoteModelOption(key: "anthropic/fable", name: "Fable", provider: "anthropic", thinkingLevels: ["off", "low", "high"], supportsImage: true),
		RemoteModelOption(key: "zai/glm", name: "GLM", provider: "zai", thinkingLevels: ["none", "high", "max"], supportsImage: false),
		RemoteModelOption(key: "anthropic/haiku", name: "Haiku", provider: "anthropic", thinkingLevels: [], supportsImage: true),
	]

	@Test func offersTheChosenModelsLevelsAndNoneForTheDefault() {
		#expect(ModelChoice().levels(in: options).isEmpty)
		#expect(ModelChoice(modelKey: "zai/glm").levels(in: options) == ["none", "high", "max"])
		#expect(ModelChoice(modelKey: "gone/model").levels(in: options).isEmpty)
	}

	@Test func keepsTheLevelOnlyWhereTheNewModelOffersIt() {
		var choice = ModelChoice(modelKey: "anthropic/fable", thinkingLevel: "high")
		choice.pick("zai/glm", in: options)
		#expect(choice == ModelChoice(modelKey: "zai/glm", thinkingLevel: "high"))
		choice.pick("anthropic/haiku", in: options)
		#expect(choice == ModelChoice(modelKey: "anthropic/haiku", thinkingLevel: nil))
		choice = ModelChoice(modelKey: "zai/glm", thinkingLevel: "max")
		choice.pick(nil, in: options)
		#expect(choice == ModelChoice(), "the default model's levels are unknown")
	}

	@Test func fallsBackWhereTheDesktopNoLongerOffersTheRememberedChoice() {
		let kept = ModelChoice(modelKey: "zai/glm", thinkingLevel: "max")
		#expect(kept.available(in: options) == kept)
		#expect(kept.available(in: []) == kept, "an unknown list keeps the choice until it arrives")
		#expect(ModelChoice(modelKey: "gone/model", thinkingLevel: "high").available(in: options) == ModelChoice())
		#expect(ModelChoice(modelKey: "zai/glm", thinkingLevel: "low").available(in: options) == ModelChoice(modelKey: "zai/glm"))
		#expect(ModelChoice().available(in: options) == ModelChoice())
	}

	@Test func groupsByProviderInTheDesktopsOrder() {
		let groups = ModelChoice.groups(options)
		#expect(groups.map(\.provider) == ["anthropic", "zai"])
		#expect(groups[0].models.map(\.key) == ["anthropic/fable", "anthropic/haiku"])
	}
}
