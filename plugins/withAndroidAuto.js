// plugins/withAndroidAuto.js — lists BusTAudioBooks in Android Auto as a media
// app. The player library already provides the browsable media service; Android
// Auto also wants this manifest entry and the small XML it points to.
const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("expo/config-plugins");

const META = "com.google.android.gms.car.application";
const XML = `<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
  <uses name="media" />
</automotiveApp>
`;

module.exports = function withAndroidAuto(config) {
  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app["meta-data"] = (app["meta-data"] || []).filter((m) => m.$["android:name"] !== META);
    app["meta-data"].push({ $: { "android:name": META, "android:resource": "@xml/automotive_app_desc" } });
    return cfg;
  });
  return withDangerousMod(config, ["android", async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "automotive_app_desc.xml"), XML);
    return cfg;
  }]);
};
