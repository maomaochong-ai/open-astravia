package org.vetta.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RemoteInputTest {
    @Test
    fun lettersDigitsAndSpacesAreKeyPresses() {
        assertEquals(
            listOf(
                RemoteKeyStroke("KeyH", shift = true),
                RemoteKeyStroke("KeyI"),
                RemoteKeyStroke("Space"),
                RemoteKeyStroke("Digit4"),
                RemoteKeyStroke("Digit2"),
                RemoteKeyStroke("Tab"),
                RemoteKeyStroke("Enter"),
            ).map(RemoteTyping::Key),
            RemoteKeys.typing("Hi 42\t\n"),
        )
    }

    @Test
    fun punctuationAndOtherLanguagesGoAsTextRuns() {
        assertEquals(
            listOf(
                RemoteTyping.Key(RemoteKeyStroke("KeyA")),
                RemoteTyping.Text(",中文"),
                RemoteTyping.Key(RemoteKeyStroke("KeyB")),
                RemoteTyping.Text("!😀"),
            ),
            RemoteKeys.typing("a,中文b!😀"),
        )
        assertEquals(listOf(RemoteTyping.Text("。")), RemoteKeys.typing("\u001b。\u0007"), "control characters are dropped")
    }

    @Test
    fun longTextIsSplitWithinTheDesktopsLimitButNotInsideAnEmoji() {
        val text = "中".repeat(RemoteKeys.MAX_TEXT - 1) + "😀" + "。"
        val runs = RemoteKeys.typing(text).map { (it as RemoteTyping.Text).text }
        assertEquals(text, runs.joinToString(""))
        assertTrue(runs.all { it.length <= RemoteKeys.MAX_TEXT })
        assertTrue(runs.none { it.first().isLowSurrogate() || it.last().isHighSurrogate() })
    }

    @Test
    fun unzoomedTouchesMapStraightOntoTheDesktop() {
        val viewport = RemoteViewport()
        assertEquals(0.25f to 0.5f, viewport.toDesktop(100f, 100f, 400f, 200f))
        assertEquals(0.5f to 0.5f, viewport.toDesktop(1f, 1f, 0f, 0f), "no size yet: the middle")
    }

    @Test
    fun zoomingKeepsThePointUnderTheFingersAndMapsTouchesThroughIt() {
        val start = RemoteViewport()
        // Pinch to 2x with the fingers over the view's top-left quarter point.
        val zoomed = start.transformed(2f, 100f, 50f, 0f, 0f, 400f, 200f)
        assertEquals(2f, zoomed.zoom)
        val (x, y) = zoomed.toDesktop(100f, 50f, 400f, 200f)
        assertEquals(0.25f, x, 0.001f)
        assertEquals(0.25f, y, 0.001f)
        // The view's centre now shows a point between the focus and the old centre.
        val (cx, cy) = zoomed.toDesktop(200f, 100f, 400f, 200f)
        assertEquals(0.375f, cx, 0.001f)
        assertEquals(0.375f, cy, 0.001f)
    }

    @Test
    fun zoomAndPanStayWithinThePicture() {
        val far = RemoteViewport().transformed(10f, 200f, 100f, 5_000f, -5_000f, 400f, 200f)
        assertEquals(RemoteViewport.MAX_ZOOM, far.zoom)
        assertEquals(600f, far.panX, "at 4x a 400px view can move 600px either way")
        assertEquals(-300f, far.panY)
        val back = far.transformed(0.01f, 200f, 100f, 0f, 0f, 400f, 200f)
        assertEquals(RemoteViewport(), back, "zooming all the way out also recentres")
        assertFalse(back.zoomed)
    }

    @Test
    fun turnsFingerTravelIntoWheelNotchesCarryingTheRest() {
        val wheel = WheelNotches(step = 40f)
        assertEquals(0, wheel.add(30f))
        assertEquals(1, wheel.add(30f), "30 + 30 passes one step, 20 carried")
        assertEquals(-1, wheel.add(-60f))
        wheel.reset()
        assertEquals(0, wheel.add(39f))
    }

    @Test
    fun theTrackpadMovesThePointerFromWhereItIsAndFasterMovesGoFurther() {
        val pad = RemoteTrackpad()
        assertEquals(RemotePointerCommand("pointer.move", 0.6f, 0.5f), pad.move(100f, 0f, speed = 100f, width = 1000f, height = 500f))
        assertEquals(RemotePointerCommand("pointer.move", 0.6f, 0.7f), pad.move(0f, 100f, speed = 100f, width = 1000f, height = 500f), "from where it was, not where the finger is")
        val fast = pad.move(100f, 0f, speed = 1400f, width = 1000f, height = 500f)!!
        assertEquals(0.9f, fast.x, 0.0001f, "a quick flick goes three times as far")
        pad.move(10_000f, 10_000f, speed = 0f, width = 1000f, height = 500f)
        assertEquals(1f to 1f, pad.x to pad.y, "the pointer stays on the screen")
        assertNull(pad.move(0f, 0f, speed = 0f, width = 1000f, height = 500f))
        assertEquals(
            listOf(
                RemotePointerCommand("pointer.move", 1f, 1f),
                RemotePointerCommand("pointer.button", 1f, 1f, "right", "down"),
                RemotePointerCommand("pointer.button", 1f, 1f, "right", "up"),
            ),
            pad.click("right"),
        )
        assertEquals(RemotePointerCommand("pointer.button", 1f, 1f, "left", "down"), pad.press("down"))
    }

    @Test
    fun aDesktopPointShowsWhereTheViewportPutsIt() {
        val viewport = RemoteViewport().transformed(2f, 500f, 250f, 0f, 0f, 1000f, 500f)
        val (x, y) = viewport.toView(0.25f, 0.5f, 1000f, 500f)
        assertEquals(0f, x, 0.001f)
        assertEquals(250f, y, 0.001f)
        val (dx, dy) = viewport.toDesktop(x, y, 1000f, 500f)
        assertEquals(0.25f, dx, 0.001f)
        assertEquals(0.5f, dy, 0.001f)
    }

    @Test
    fun theDesktopsPointerIsDrawnAtAReadableSize() {
        val cursor = RemoteScreenCursor(ByteArray(0), width = 16f, height = 24f, hotspotX = 0f, hotspotY = 0f, screenWidth = 1500f)
        assertEquals(18f / 24f, cursor.scale(shownWidth = 400f), 0.0001f, "never smaller than 18 dp")
        assertEquals(30f / 24f, cursor.scale(shownWidth = 4000f), 0.0001f, "never larger than 30 dp")
        assertEquals(1f, cursor.scale(shownWidth = 1500f), 0.0001f)
    }
}
