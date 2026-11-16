package com.bustaudio.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object WidgetArtwork {
    private var attempted = ""
    private var bitmapKey = ""
    private var bitmap: Bitmap? = null
    private fun file(context: Context) = File(context.cacheDir, "bustaudio-widget-cover.png")
    private fun prefs(context: Context) = context.getSharedPreferences("bustaudio_widget_art", Context.MODE_PRIVATE)

    fun cached(context: Context, key: String): Bitmap? {
        if (key.isEmpty()) return null
        if (bitmapKey == key) return bitmap
        if (prefs(context).getString("key", "") != key) return null
        return try { BitmapFactory.decodeFile(file(context).path)?.also { bitmap = it; bitmapKey = key } }
            catch (_: Exception) { null }
    }

    fun clear(context: Context) {
        attempted = ""; bitmapKey = ""; bitmap = null
        file(context).delete(); prefs(context).edit().clear().apply()
    }

    fun fetch(context: Context, key: String) {
        if (key.isEmpty() || attempted == key || cached(context, key) != null) return
        attempted = key
        // Covers only. No stream URLs, credentials, unbounded reads or main-thread I/O.
        if (!key.startsWith("https://") && !key.startsWith("http://")) return
        Thread({
            var connection: HttpURLConnection? = null
            val image = try {
                connection = URL(key).openConnection() as HttpURLConnection
                connection.connectTimeout = 3000; connection.readTimeout = 3000
                connection.instanceFollowRedirects = false
                if (connection.responseCode != 200 || connection.contentLengthLong > 1048576) null
                else {
                    val bytes = connection.inputStream.use { input ->
                        val out = ByteArrayOutputStream(); val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            if (out.size() + count > 1048576) throw IllegalStateException("Cover too large")
                            out.write(buffer, 0, count)
                        }
                        out.toByteArray()
                    }
                    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                    if (options.outWidth <= 0 || options.outHeight <= 0) null
                    else {
                        options.inJustDecodeBounds = false; options.inSampleSize = 1
                        while (options.outWidth / options.inSampleSize > 160 || options.outHeight / options.inSampleSize > 160) options.inSampleSize *= 2
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                    }
                }
            } catch (_: Exception) { null }
            finally { connection?.disconnect() }
            if (image != null) Handler(Looper.getMainLooper()).post {
                if (ListeningWidgetProvider.hasWidgets(context) && ListeningWidgetProvider.load(context).artwork == key) {
                    bitmap = image; bitmapKey = key
                    try {
                        file(context).outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
                        prefs(context).edit().putString("key", key).apply()
                    } catch (_: Exception) { /* In-memory cover still works. */ }
                    ListeningWidgetProvider.render(context)
                }
            }
        }, "BusTAudio-widget-cover").apply { isDaemon = true }.start()
    }
}
