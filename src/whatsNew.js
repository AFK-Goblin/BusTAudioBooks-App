// src/whatsNew.js — the "What's new" sheet shown once after an update (and
// any time from Settings → About). Bump `id` when the list changes.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bustaudio_whats_new_seen";

export const WHATS_NEW = {
  id: "3.2.0",
  items: [
    { icon: "📊", title: "Your listening", body: "Stats, streaks, time per book and an optional daily goal. Tap the line under the Home greeting." },
    { icon: "📚", title: "Next in series", body: "Book pages show the whole series; finish one and Home suggests the next (needs the 3.1 server)." },
    { icon: "🚘", title: "Android Auto", body: "Your downloaded books are on the car's screen: Continue listening, then everything downloaded. Picking one resumes it where you left off." },
    { icon: "🔔", title: "Notifications", body: "Hear when a book you're waiting on is ready on TorBox, and when a new book in your series comes out — even with the app closed (Settings → Notifications)." },
    { icon: "✨", title: "Because you listened…", body: "Home suggests books like your latest one, and shows new and upcoming books in your series (needs the 3.2 server)." },
    { icon: "⏬", title: "Download when ready", body: "Book not cached on TorBox yet? Tap “Download when ready” and it downloads by itself once TorBox has it." },
    { icon: "★", title: "Want to Listen", body: "Save a book for later from its page. It waits on Home and in your Library." },
    { icon: "↶", title: "Undo a jump", body: "Tapped the wrong chapter? “Back to …” returns you to where you were." },
    { icon: "⭐", title: "Rate what you finish", body: "Give finished books stars, and get an “Up next” from your Want to Listen." },
    { icon: "🔖", title: "All bookmarks", body: "Library → Bookmarks lists every bookmark and note, and shares them as text." },
    { icon: "🚗", title: "Car mode", body: "Player ⋯ → Car mode: only big buttons, for driving." },
    { icon: "🎨", title: "Make it yours", body: "Accent colours in Settings → Appearance, and a cover grid in the Library." },
    { icon: "🗂", title: "Manage downloads", body: "Settings → Downloads → Manage lists books by size, so the biggest go first." },
    { icon: "💾", title: "Back up your library", body: "Settings → Backup keeps your progress, bookmarks and stats safe as text." },
  ],
};

export async function whatsNewPending() {
  try {
    return (await AsyncStorage.getItem(KEY)) !== WHATS_NEW.id;
  } catch (_) {
    return false;
  }
}

export async function markWhatsNewSeen() {
  try {
    await AsyncStorage.setItem(KEY, WHATS_NEW.id);
  } catch (_) {
    /* shown again next launch */
  }
}
