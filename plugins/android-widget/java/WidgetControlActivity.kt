package com.bustaudio.app.widget

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.media3.common.Player

// A direct, user-tapped Activity PendingIntent can legally open the app when
// Android has killed its player. A receiver-to-activity trampoline cannot.
class WidgetControlActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val command = intent.getStringExtra("command") ?: "open"
        val expected = intent.getStringExtra("expectedMediaId") ?: ""
        WidgetConnection.connect(this) { controller ->
            if (isFinishing || isDestroyed) return@connect
            try {
                val state = controller?.let { ListeningWidgetProvider.fromPlayer(it) } ?: WidgetState()
                when (WidgetPolicy.action(command, expected, state)) {
                    "open" -> openApp()
                    "play" -> if (controller!!.isCommandAvailable(Player.COMMAND_PLAY_PAUSE)) controller.play() else openApp()
                    "pause" -> if (controller!!.isCommandAvailable(Player.COMMAND_PLAY_PAUSE)) controller.pause() else openApp()
                    "back" -> if (controller!!.isCommandAvailable(Player.COMMAND_SEEK_BACK)) controller.seekBack() else openApp()
                    "forward" -> if (controller!!.isCommandAvailable(Player.COMMAND_SEEK_FORWARD)) controller.seekForward() else openApp()
                    // Another book is now playing. Refresh instead of seeking it.
                    "refresh" -> Unit
                }
                val updated = controller?.let { ListeningWidgetProvider.fromPlayer(it) } ?: state
                ListeningWidgetProvider.save(this, updated)
                ListeningWidgetProvider.render(this, updated)
            } catch (_: Exception) { openApp() }
            finally { finish() }
        }
    }

    private fun openApp() {
        packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(it)
        }
    }
}
