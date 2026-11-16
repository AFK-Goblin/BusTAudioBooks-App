package com.bustaudio.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.widget.RemoteViews
import androidx.media3.common.Player
import com.bustaudio.app.R
import org.json.JSONObject

class ListeningWidgetProvider : AppWidgetProvider() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == SNAPSHOT) {
            if (!hasWidgets(context)) return
            val previous = load(context)
            val state = when {
                intent.getBooleanExtra("clear", false) -> WidgetState()
                !intent.getBooleanExtra("available", false) -> previous.copy(playing = false, available = false)
                else -> WidgetState(
                    mediaId = intent.getStringExtra("mediaId") ?: "",
                    title = intent.getStringExtra("title") ?: "BusTAudio",
                    chapter = intent.getStringExtra("chapter") ?: "",
                    positionMs = intent.getLongExtra("position", 0).coerceAtLeast(0),
                    durationMs = intent.getLongExtra("duration", 0).coerceAtLeast(0),
                    playing = intent.getBooleanExtra("playing", false), available = true,
                    backwardSeconds = intent.getIntExtra("backward", 15).coerceIn(1, 3600),
                    forwardSeconds = intent.getIntExtra("forward", 30).coerceIn(1, 3600),
                    artwork = intent.getStringExtra("artwork") ?: "",
                )
            }
            save(context, state)
            render(context, state)
            return
        }
        super.onReceive(context, intent)
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        // Persisted text is useful after a reboot, but is never proof of a live player.
        render(context, load(context).copy(playing = false, available = false))
        val pending = goAsync()
        WidgetConnection.connect(context) { controller ->
            try {
                val state = controller?.let { fromPlayer(it) }
                    ?: load(context).copy(playing = false, available = false)
                save(context, state)
                render(context, state)
            } finally { pending.finish() }
        }
    }

    override fun onDisabled(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        WidgetArtwork.clear(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        render(context)
    }

    companion object {
        const val SNAPSHOT = "com.bustaudio.app.WIDGET_SNAPSHOT"
        private const val PREFS = "bustaudio_widget_display"
        fun ids(context: Context): IntArray = AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, ListeningWidgetProvider::class.java))
        fun hasWidgets(context: Context) = ids(context).isNotEmpty()

        fun fromPlayer(player: Player): WidgetState {
            val item = player.currentMediaItem ?: return WidgetState()
            val meta = player.mediaMetadata
            return WidgetState(
                mediaId = item.mediaId, title = meta.albumTitle?.toString() ?: meta.title?.toString() ?: "BusTAudio",
                chapter = meta.title?.toString() ?: "", positionMs = player.currentPosition.coerceAtLeast(0),
                durationMs = player.duration.coerceAtLeast(0),
                playing = player.playWhenReady && player.playbackState != Player.STATE_ENDED,
                available = true, backwardSeconds = (player.seekBackIncrement / 1000).toInt().coerceIn(1, 3600),
                forwardSeconds = (player.seekForwardIncrement / 1000).toInt().coerceIn(1, 3600),
                artwork = meta.artworkUri?.toString() ?: "",
            )
        }

        fun load(context: Context): WidgetState = try {
            val json = JSONObject(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("state", "{}") ?: "{}")
            WidgetState(json.optString("id"), json.optString("title"), json.optString("chapter"),
                json.optLong("position"), json.optLong("duration"), json.optBoolean("playing"),
                json.optBoolean("available"), json.optInt("backward", 15), json.optInt("forward", 30), json.optString("artwork"))
        } catch (_: Exception) { WidgetState() }

        fun save(context: Context, state: WidgetState) {
            if (!hasWidgets(context)) return
            val json = JSONObject().apply {
                put("id", state.mediaId); put("title", state.title); put("chapter", state.chapter)
                put("position", state.positionMs); put("duration", state.durationMs)
                put("playing", state.playing); put("available", state.available)
                put("backward", state.backwardSeconds); put("forward", state.forwardSeconds); put("artwork", state.artwork)
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("state", json.toString()).apply()
        }

        fun render(context: Context, state: WidgetState = load(context)) {
            val widgetIds = ids(context)
            if (widgetIds.isEmpty()) return
            val manager = AppWidgetManager.getInstance(context)
            val compact = createViews(context, state, R.layout.bustaudio_listening_widget_compact)
            val wide = createViews(context, state, R.layout.bustaudio_listening_widget)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // The launcher selects independently for each instance and orientation.
                manager.updateAppWidget(widgetIds, RemoteViews(mapOf(
                    SizeF(110f, 148f) to compact,
                    SizeF(250f, 148f) to wide,
                )))
            } else {
                for (id in widgetIds) {
                    val options = manager.getAppWidgetOptions(id)
                    val portraitWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
                    val landscapeWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, portraitWidth)
                    manager.updateAppWidget(id, RemoteViews(
                        if (landscapeWidth >= 250) wide else compact,
                        if (portraitWidth >= 250) wide else compact,
                    ))
                }
            }
            WidgetArtwork.fetch(context.applicationContext, state.artwork)
        }

        private fun createViews(context: Context, state: WidgetState, layout: Int): RemoteViews {
            val views = RemoteViews(context.packageName, layout)
            val title = state.title.ifBlank { "BusTAudio" }
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_chapter, when {
                state.mediaId.isEmpty() -> "Open the app and choose a book"
                !state.available -> "Open the app to resume"
                else -> state.chapter
            })
            val position = if (state.durationMs > 0) "${WidgetPolicy.time(state.positionMs)} / ${WidgetPolicy.time(state.durationMs)}"
                else WidgetPolicy.time(state.positionMs)
            views.setTextViewText(R.id.widget_position, if (state.mediaId.isEmpty()) "Ready to listen" else position)
            views.setProgressBar(R.id.widget_progress, 100, WidgetPolicy.progress(state), false)
            views.setTextViewText(R.id.widget_back, "−${state.backwardSeconds}")
            views.setTextViewText(R.id.widget_forward, "+${state.forwardSeconds}")
            views.setContentDescription(R.id.widget_back, "Back ${state.backwardSeconds} seconds")
            views.setContentDescription(R.id.widget_forward, "Forward ${state.forwardSeconds} seconds")
            views.setImageViewResource(R.id.widget_toggle, if (state.available && state.playing) R.drawable.bustaudio_widget_pause else R.drawable.bustaudio_widget_play)
            views.setContentDescription(R.id.widget_toggle, if (!state.available) "Open BusTAudio to resume" else if (state.playing) "Pause" else "Play")
            views.setContentDescription(R.id.widget_book, "$title. ${state.chapter}. Open BusTAudio")
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                views.setOnClickPendingIntent(R.id.widget_book, PendingIntent.getActivity(context, 40, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
            for ((id, action) in listOf(R.id.widget_toggle to "toggle", R.id.widget_back to "back", R.id.widget_forward to "forward")) {
                val intent = Intent(context, WidgetControlActivity::class.java)
                    .setData(Uri.parse(WidgetPolicy.controlUri(action, state.mediaId)))
                    .putExtra("command", action).putExtra("expectedMediaId", state.mediaId)
                views.setOnClickPendingIntent(id, PendingIntent.getActivity(context, id, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
            val art = WidgetArtwork.cached(context, state.artwork)
            if (art != null) views.setImageViewBitmap(R.id.widget_cover, art)
            else views.setImageViewResource(R.id.widget_cover, R.drawable.bustaudio_widget_book)
            return views
        }
    }
}
