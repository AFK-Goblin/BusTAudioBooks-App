package com.bustaudio.app.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class WidgetPolicyTest {
    @Test fun layoutsKeepControlsUsableInNarrowAndShortSpaces() {
        val cases = listOf(
            Triple(57, 455, "column"), Triple(100, 260, "column"),
            Triple(276, 102, "row"), Triple(554, 51, "row"),
            Triple(232, 50, "row"), Triple(200, 40, "row"),
            Triple(130, 150, "square"), Triple(180, 170, "square"),
            Triple(130, 337, "compact"), Triple(200, 400, "compact"),
            Triple(276, 220, "wide"), Triple(554, 184, "wide"),
            Triple(250, 500, "wide"),
        )
        for ((width, height, expected) in cases)
            assertEquals("$width x $height", expected, WidgetPolicy.layout(width, height))
    }

    @Test fun missingLauncherDimensionsUseThePresetInsteadOfGuessing() {
        for ((width, height) in listOf(0 to 0, 0 to 300, 300 to 0, -1 to 200))
            assertEquals(null, WidgetPolicy.layout(width, height))
    }

    private val book = WidgetState(mediaId = "book-a", available = true)

    @Test fun previousBookPendingIntentCannotBeReusedForAnotherBook() {
        assertNotEquals(WidgetPolicy.controlUri("back", "book-a"), WidgetPolicy.controlUri("back", "book-b"))
        assertNotEquals(WidgetPolicy.controlUri("back", "book-a"), WidgetPolicy.controlUri("forward", "book-a"))
        val uri = java.net.URI(WidgetPolicy.controlUri("back", "a?b&c/#:4"))
        assertEquals("a?b&c/#:4", java.net.URLDecoder.decode(uri.rawQuery.removePrefix("mediaId="), "UTF-8"))
    }

    @Test fun pausedBookCanBePlayed() {
        assertEquals("play", WidgetPolicy.action("toggle", "book-a", book))
    }

    @Test fun playingBookCanBePaused() {
        assertEquals("pause", WidgetPolicy.action("toggle", "book-a", book.copy(playing = true)))
    }

    @Test fun seekControlsPreserveTheirDirection() {
        assertEquals("back", WidgetPolicy.action("back", "book-a", book))
        assertEquals("forward", WidgetPolicy.action("forward", "book-a", book))
    }

    @Test fun staleControlsCannotCommandTheNewBook() {
        for (request in listOf("toggle", "back", "forward")) {
            assertEquals(request, "refresh", WidgetPolicy.action(request, "previous-book", book))
            assertEquals(request, "refresh", WidgetPolicy.action(request, "", book))
        }
    }

    @Test fun unavailableBookOpensTheApp() {
        for (request in listOf("toggle", "back", "forward")) {
            assertEquals(request, "open", WidgetPolicy.action(request, "book-a", book.copy(available = false)))
        }
    }

    @Test fun missingMediaOpensTheAppEvenIfMarkedAvailable() {
        assertEquals("open", WidgetPolicy.action("toggle", "", book.copy(mediaId = "")))
        assertEquals("open", WidgetPolicy.action("toggle", "book-a", WidgetState()))
    }

    @Test fun unknownCommandsOpenTheApp() {
        assertEquals("open", WidgetPolicy.action("delete", "book-a", book))
        assertEquals("open", WidgetPolicy.action("", "book-a", book))
        assertEquals("open", WidgetPolicy.action("delete", "previous-book", book))
    }

    @Test fun progressReportsElapsedPercentage() {
        assertEquals(0, WidgetPolicy.progress(book.copy(positionMs = 0, durationMs = 100_000)))
        assertEquals(25, WidgetPolicy.progress(book.copy(positionMs = 25_000, durationMs = 100_000)))
        assertEquals(100, WidgetPolicy.progress(book.copy(positionMs = 100_000, durationMs = 100_000)))
    }

    @Test fun unknownDurationHasNoProgress() {
        for (duration in listOf(0L, -1L, Long.MIN_VALUE)) {
            assertEquals("duration=$duration", 0, WidgetPolicy.progress(book.copy(positionMs = 65_000, durationMs = duration)))
        }
    }

    @Test fun progressIsClampedAtBothEnds() {
        assertEquals(0, WidgetPolicy.progress(book.copy(positionMs = -1, durationMs = 100)))
        assertEquals(0, WidgetPolicy.progress(book.copy(positionMs = Long.MIN_VALUE, durationMs = 100)))
        assertEquals(100, WidgetPolicy.progress(book.copy(positionMs = 200, durationMs = 100)))
        assertEquals(100, WidgetPolicy.progress(book.copy(positionMs = Long.MAX_VALUE, durationMs = 100)))
    }

    @Test fun progressDoesNotOverflowForLargeDurations() {
        assertEquals(50, WidgetPolicy.progress(book.copy(positionMs = Long.MAX_VALUE / 2, durationMs = Long.MAX_VALUE)))
        assertEquals(100, WidgetPolicy.progress(book.copy(positionMs = Long.MAX_VALUE, durationMs = Long.MAX_VALUE)))
    }

    @Test fun timeUsesReadableMinutesAndHours() {
        val cases = listOf(0L to "0:00", 999L to "0:00", 1_000L to "0:01", 65_000L to "1:05", 3_599_000L to "59:59", 3_600_000L to "1:00:00", 3_661_000L to "1:01:01")
        for ((millis, expected) in cases) assertEquals("millis=$millis", expected, WidgetPolicy.time(millis))
    }

    @Test fun negativeTimeDisplaysZero() {
        assertEquals("0:00", WidgetPolicy.time(-1))
        assertEquals("0:00", WidgetPolicy.time(Long.MIN_VALUE))
    }
}
