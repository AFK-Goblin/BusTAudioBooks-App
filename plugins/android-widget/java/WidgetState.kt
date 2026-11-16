package com.bustaudio.app.widget

data class WidgetState(
    val mediaId: String = "", val title: String = "", val chapter: String = "",
    val positionMs: Long = 0, val durationMs: Long = 0,
    val playing: Boolean = false, val available: Boolean = false,
    val backwardSeconds: Int = 15, val forwardSeconds: Int = 30, val artwork: String = "",
)

object WidgetPolicy {
    fun layout(width: Int, height: Int): String? = when {
        width <= 0 || height <= 0 -> null
        width < 110 -> "column"
        width >= 200 && height < 148 -> "row"
        width >= 250 -> "wide"
        height < 180 -> "square"
        else -> "compact"
    }

    fun controlUri(action: String, mediaId: String): String =
        "bustaudio-widget://control/$action?mediaId=${java.net.URLEncoder.encode(mediaId, "UTF-8")}"

    fun action(request: String, expectedMediaId: String, state: WidgetState): String {
        if (request !in listOf("toggle", "back", "forward")) return "open"
        if (!state.available || state.mediaId.isEmpty()) return "open"
        if (expectedMediaId != state.mediaId) return "refresh"
        return if (request == "toggle") { if (state.playing) "pause" else "play" } else request
    }

    fun progress(state: WidgetState): Int {
        if (state.durationMs <= 0) return 0
        return (state.positionMs.coerceAtLeast(0).toDouble() / state.durationMs * 100).toInt().coerceIn(0, 100)
    }

    fun time(ms: Long): String {
        val seconds = ms.coerceAtLeast(0) / 1000
        val hours = seconds / 3600
        val minutes = seconds / 60 % 60
        val tail = (seconds % 60).toString().padStart(2, '0')
        return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:$tail" else "$minutes:$tail"
    }
}
