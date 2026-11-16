const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");

const PROVIDER = "com.bustaudio.app.widget.ListeningWidgetProvider";
const CONTROL_ACTIVITY = "com.bustaudio.app.widget.WidgetControlActivity";
const DEPENDENCIES = [
  ["implementation", "androidx.media3:media3-session:1.9.2"],
  ["implementation", "androidx.media3:media3-common:1.9.2"],
  ["testImplementation", "junit:junit:4.13.2"],
];

module.exports = function withListeningWidget(config) {
  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.receiver = (app.receiver || []).filter((entry) => entry.$["android:name"] !== PROVIDER);
    app.receiver.push({
      $: { "android:name": PROVIDER, "android:exported": "false" },
      "intent-filter": [{
        action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }],
      }],
      "meta-data": [{
        $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/bustaudio_listening_widget" },
      }],
    });
    app.activity = (app.activity || []).filter((entry) => entry.$["android:name"] !== CONTROL_ACTIVITY);
    app.activity.push({
      $: {
        "android:name": CONTROL_ACTIVITY,
        "android:exported": "false",
        "android:excludeFromRecents": "true",
        "android:theme": "@style/BusTAudioWidgetActionTheme",
      },
    });
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("BusTAudio listening widget requires a Groovy app/build.gradle file.");
    }
    const contents = cfg.modResults.contents;
    const missing = DEPENDENCIES.filter(([configuration, coordinate]) => {
      const escaped = coordinate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`^\\s*${configuration}\\s*(?:\\(\\s*)?["']${escaped}["']`, "m").test(contents);
    });
    if (missing.length) {
      // A separate top-level block preserves the project's existing Gradle configuration.
      cfg.modResults.contents += `\n// BusTAudio home-screen widget\ndependencies {\n${missing.map(([configuration, coordinate]) => `    ${configuration} "${coordinate}"`).join("\n")}\n}\n`;
    }
    return cfg;
  });

  return withDangerousMod(config, ["android", (cfg) => {
    const source = path.join(cfg.modRequest.projectRoot, "plugins", "android-widget");
    const target = path.join(cfg.modRequest.platformProjectRoot, "app", "src");
    for (const [from, to] of [
      ["java", "main/java/com/bustaudio/app/widget"],
      ["res", "main/res"],
      ["test", "test/java/com/bustaudio/app/widget"],
    ]) {
      fs.cpSync(path.join(source, from), path.join(target, to), { recursive: true });
    }
    return cfg;
  }]);
};
