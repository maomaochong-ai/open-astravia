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
}
