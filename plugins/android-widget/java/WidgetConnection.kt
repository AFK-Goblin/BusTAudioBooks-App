package com.bustaudio.app.widget

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken

object WidgetConnection {
    // Bounded lifetime: neither a home-screen widget nor a failed connection
    // keeps the playback service/controller alive indefinitely.
    fun connect(context: Context, callback: (MediaController?) -> Unit) {
        val handler = Handler(Looper.getMainLooper())
        val token = SessionToken(context, ComponentName(context.packageName,
            "com.doublesymmetry.trackplayer.TrackPlayerPlaybackService"))
        val future = try { MediaController.Builder(context.applicationContext, token).buildAsync() }
            catch (_: Exception) { callback(null); return }
        var completed = false
        fun complete(controller: MediaController?) {
            if (completed) return
            completed = true
            try { callback(controller) } finally { MediaController.releaseFuture(future) }
        }
        val timeout = Runnable { complete(null) }
        handler.postDelayed(timeout, 6000)
        future.addListener({
            handler.removeCallbacks(timeout)
            if (!completed) {
                val controller = try { future.get() } catch (_: Exception) { null }
                complete(controller)
            }
        }, { task -> handler.post(task) })
    }
}
