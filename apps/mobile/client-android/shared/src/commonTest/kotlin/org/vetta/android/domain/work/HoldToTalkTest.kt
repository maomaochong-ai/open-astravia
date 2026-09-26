package org.vetta.android.domain.work

import kotlin.test.Test
import kotlin.test.assertEquals

class HoldToTalkTest {
    @Test
    fun aQuickTapStartsTyping() {
        val press = HoldToTalk()
        assertEquals(HoldToTalk.Action.None, press.began(0))
        assertEquals(HoldToTalk.Action.None, press.moved(1f, 1f, 50))
        assertEquals(HoldToTalk.Action.Focus, press.ended(80))
        assertEquals(HoldToTalk.Phase.Idle, press.phase)
    }

    @Test
    fun holdingListensAndReleasingInserts() {
        val press = HoldToTalk()
        press.began(0)
        assertEquals(HoldToTalk.Action.None, press.moved(0f, 0f, 90))
        assertEquals(HoldToTalk.Action.StartListening, press.moved(0f, 0f, 100), "a timer tick while holding still starts dictation")
        assertEquals(HoldToTalk.Action.None, press.moved(3f, -20f, 1_000), "small drift while talking changes nothing")
        assertEquals(HoldToTalk.Action.Finish(insert = true), press.ended(2_000))
    }

    @Test
    fun slidingUpArmsCancelAndBackDownDisarmsIt() {
        val press = HoldToTalk()
        press.began(0)
        press.moved(0f, 0f, 400)
        assertEquals(HoldToTalk.Action.CancelArmed(true), press.moved(0f, -80f, 1_000))
        assertEquals(HoldToTalk.Action.None, press.moved(0f, -90f, 1_100))
        assertEquals(HoldToTalk.Action.CancelArmed(false), press.moved(0f, -10f, 1_200))
        press.moved(0f, -100f, 1_300)
        assertEquals(HoldToTalk.Action.Finish(insert = false), press.ended(1_500))
    }

    @Test
    fun aSlowTapThatJustStartedListeningTypesInstead() {
        val press = HoldToTalk()
        press.began(0)
        press.moved(0f, 0f, 100)
        assertEquals(HoldToTalk.Action.CancelAndFocus, press.ended(250))
        assertEquals(HoldToTalk.Phase.Idle, press.phase)
    }

    @Test
    fun aTapTheTimerMissedIsStillATap() {
        val press = HoldToTalk()
        press.began(0)
        assertEquals(HoldToTalk.Action.Focus, press.ended(150), "never reached listening, so it was a tap")
    }

    @Test
    fun movingAwayBeforeTheHoldIsNotAPress() {
        val press = HoldToTalk()
        press.began(0)
        assertEquals(HoldToTalk.Action.None, press.moved(0f, 30f, 100))
        assertEquals(HoldToTalk.Action.None, press.moved(0f, 0f, 500), "an abandoned touch never starts listening")
        assertEquals(HoldToTalk.Action.None, press.ended(600))
    }
}
