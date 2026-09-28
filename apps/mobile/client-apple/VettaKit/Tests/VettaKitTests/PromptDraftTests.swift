import Foundation
import Testing
@testable import VettaKit

@Suite struct PromptDraftTests {
	private func file(_ name: String, bytes: Int) -> PromptAttachment {
		PromptAttachment(kind: .file, name: name, mimeType: "application/octet-stream", data: Data(count: bytes))
	}

	@Test func needsWordsToSendAndClearsAfterwards() throws {
		var draft = PromptDraft(text: "  \n ")
		#expect(!draft.canSend)
		try draft.add(file("a.txt", bytes: 10))
		#expect(!draft.canSend, "an attachment alone is not a prompt")
		draft.text = "看看这个\n第二行"
		#expect(draft.canSend)
		#expect(draft.trimmedText == "看看这个\n第二行", "newlines inside the prompt are kept")
		draft.clear()
		#expect(draft.isEmpty)
	}

	@Test func refusesFilesAFrameCannotCarryAndTooManyAttachments() throws {
		var draft = PromptDraft()
		#expect(throws: PromptAttachmentError.tooLarge(name: "big.zip")) { try draft.add(file("big.zip", bytes: RemoteAPI.maxUploadBytes + 1)) }
		#expect(throws: PromptAttachmentError.tooLarge(name: "empty")) { try draft.add(file("empty", bytes: 0)) }
		for index in 0 ..< PromptDraft.maxAttachments {
			try draft.add(file("f\(index)", bytes: RemoteAPI.maxUploadBytes))
		}
		#expect(throws: PromptAttachmentError.tooMany) { try draft.add(file("one more", bytes: 1)) }
		let first = try #require(draft.attachments.first)
		draft.remove(first.id)
		#expect(draft.attachments.count == PromptDraft.maxAttachments - 1)
	}

	@Test func sendsASkillWithoutWordsAndKeepsOneScene() {
		let pdf = SkillReference(kind: .skill, name: "pdf")
		let weekly = SkillReference(kind: .scene, name: "weekly")
		var draft = PromptDraft()
		draft.add(pdf)
		#expect(draft.canSend, "a skill is often the whole instruction")
		#expect(!draft.isEmpty)
		#expect(draft.promptText == "@skill:pdf")
		draft.add(pdf)
		draft.add(weekly)
		draft.add(SkillReference(kind: .scene, name: "daily"))
		#expect(draft.skills.map(\.id) == ["skill:pdf", "scene:daily"], "no duplicates; a second scene replaces the first")
		draft.text = "  合并这两份  "
		#expect(draft.promptText == "@skill:pdf @scene:daily 合并这两份")
		draft.removeSkill(pdf.id)
		#expect(draft.skills.map(\.id) == ["scene:daily"])
		draft.clear()
		#expect(draft.isEmpty)
	}
}

@Suite struct SkillTokensTests {
	@Test func quotesNamesTheDesktopCannotReadBare() {
		#expect(SkillReference(kind: .skill, name: "前端设计").token == "@skill:前端设计")
		#expect(SkillReference(kind: .skill, name: "pdf tools").token == #"@skill:"pdf tools""#)
		#expect(SkillReference(kind: .scene, name: #"say "hi""#).token == #"@scene:"say hi""#)
	}

	@Test func splitsTheLeadingReferencesFromTheText() {
		let (skills, body) = SkillTokens.split(#"@skill:pdf  @scene:"周 报" @skill:pdf 帮我写 @skill:later"#)
		#expect(skills.map(\.id) == ["skill:pdf", "scene:周 报"])
		#expect(body == "帮我写 @skill:later", "a token mid-sentence stays in the text")

		#expect(SkillTokens.split("@skill:pdf").skills.map(\.name) == ["pdf"])
		#expect(SkillTokens.split("@skill:pdf").body == "")
		#expect(SkillTokens.split("@skill:pdf，然后") == SkillTokens.split("@skill:pdf ，然后"), "full-width punctuation ends a bare name, as on the desktop")
		#expect(SkillTokens.split("@skill:pdf，然后").body == "，然后")
		#expect(SkillTokens.split("mail a@skill:x").skills.isEmpty)
		#expect(SkillTokens.split(#"@skill:"open"#).skills.isEmpty, "an unclosed quote is plain text")
		#expect(SkillTokens.split("@mcp:github hi").body == "@mcp:github hi")
	}

	@Test func roundTripsWhatTheDraftSends() {
		let skills = [SkillReference(kind: .skill, name: "a b"), SkillReference(kind: .scene, name: "周报")]
		let split = SkillTokens.split(SkillTokens.prompt(skills, "正文\n第二行"))
		#expect(split.skills == skills)
		#expect(split.body == "正文\n第二行")
	}

	@Test func searchesNamesAliasesAndDescriptionsInTheDesktopsOrder() {
		let options = [
			RemoteSkillOption(name: "frontend-design", alias: "前端设计", description: "Build pages", kind: .skill, source: "builtin"),
			RemoteSkillOption(name: "pdf", description: "合并与拆分 PDF", kind: .skill, source: "user"),
			RemoteSkillOption(name: "weekly", description: "Write the weekly DESIGN review", kind: .scene, source: "scene"),
		]
		#expect(options.matching("  ").map(\.name) == ["frontend-design", "pdf", "weekly"])
		#expect(options.matching("design").map(\.name) == ["frontend-design", "weekly"])
		#expect(options.matching("前端").map(\.name) == ["frontend-design"])
		#expect(options.matching("拆分").map(\.name) == ["pdf"])
	}
}
