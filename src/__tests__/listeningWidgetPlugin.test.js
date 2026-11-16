/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const withListeningWidget = require('../../plugins/withListeningWidget');

function widgetConfig() {
  return withListeningWidget({ name: 'BusTAudioBooks', slug: 'bustaudio', android: { package: 'com.bustaudio.app' } });
}

async function applyMod(name, modResults, modRequest = {}) {
  const config = widgetConfig();
  return (await config.mods.android[name]({ ...config, modResults, modRequest })).modResults;
}

describe('listening widget Expo integration', () => {
  it('registers private widget components without replacing other application entries', async () => {
    const existingActivity = { $: { 'android:name': '.MainActivity', 'android:exported': 'true' } };
    const existingReceiver = { $: { 'android:name': '.NotificationReceiver' } };
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, activity: [existingActivity], receiver: [existingReceiver] }] } };
    const result = await applyMod('manifest', manifest);
    const app = result.manifest.application[0];
    expect(app.activity).toContainEqual(existingActivity);
    expect(app.receiver).toContainEqual(existingReceiver);
    expect(app.receiver).toContainEqual({
      $: { 'android:name': 'com.bustaudio.app.widget.ListeningWidgetProvider', 'android:exported': 'false' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/bustaudio_listening_widget' } }],
    });
    expect(app.activity).toContainEqual({ $: {
      'android:name': 'com.bustaudio.app.widget.WidgetControlActivity',
      'android:exported': 'false',
      'android:excludeFromRecents': 'true',
      'android:theme': '@style/BusTAudioWidgetActionTheme',
    } });
    const snapshot = JSON.parse(JSON.stringify(result));
    expect(await applyMod('manifest', result)).toEqual(snapshot);
  });

  it('repairs old widget declarations and removes duplicates on generation', async () => {
    const staleReceiver = { $: { 'android:name': 'com.bustaudio.app.widget.ListeningWidgetProvider', 'android:exported': 'true' } };
    const staleActivity = { $: { 'android:name': 'com.bustaudio.app.widget.WidgetControlActivity', 'android:exported': 'true' } };
    const result = await applyMod('manifest', { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, receiver: [staleReceiver, staleReceiver], activity: [staleActivity, staleActivity] }] } });
    const app = result.manifest.application[0];
    expect(app.receiver).toHaveLength(1);
    expect(app.activity).toHaveLength(1);
    expect(app.receiver[0].$['android:exported']).toBe('false');
    expect(app.activity[0].$['android:exported']).toBe('false');
  });

  it('adds Media3 and native unit test dependencies once while preserving the Gradle project', async () => {
    const original = 'plugins { id "com.android.application" }\ndependencies {\n    implementation("com.example:existing:2.0")\n}\n';
    const result = await applyMod('appBuildGradle', { language: 'groovy', contents: original });
    expect(result.contents.startsWith(original)).toBe(true);
    expect(result.contents).toMatch(/implementation\s+['"]androidx\.media3:media3-session:1\.9\.2['"]/);
    expect(result.contents).toMatch(/implementation\s+['"]androidx\.media3:media3-common:1\.9\.2['"]/);
    expect(result.contents).toMatch(/testImplementation\s+['"]junit:junit:4\.13\.2['"]/);
    expect(await applyMod('appBuildGradle', result)).toEqual(result);
  });

  it('reuses existing dependencies in Groovy parenthesized and quoted syntax', async () => {
    const contents = `dependencies {
    implementation("androidx.media3:media3-session:1.9.2")
    implementation 'androidx.media3:media3-common:1.9.2'
    testImplementation("junit:junit:4.13.2")
}\n`;
    expect(await applyMod('appBuildGradle', { language: 'groovy', contents })).toEqual({ language: 'groovy', contents });
  });

  it('does not mistake a commented-out dependency for an installed one', async () => {
    const contents = '// implementation "androidx.media3:media3-session:1.9.2"\ndependencies {}\n';
    const result = await applyMod('appBuildGradle', { language: 'groovy', contents });
    expect(result.contents.slice(contents.length)).toContain('implementation "androidx.media3:media3-session:1.9.2"');
  });

  it('fails clearly when the generated Gradle language is unsupported', async () => {
    await expect(applyMod('appBuildGradle', { language: 'kotlin', contents: 'dependencies {}' })).rejects.toThrow(/listening widget.*Groovy/i);
  });

  it('copies widget sources, resources, and executable native tests without removing unrelated files', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bustaudio-widget-'));
    const platformProjectRoot = path.join(projectRoot, 'android');
    const assets = path.join(projectRoot, 'plugins', 'android-widget');
    const files = [
      ['java/ListeningWidgetProvider.kt', 'main/java/com/bustaudio/app/widget/ListeningWidgetProvider.kt', 'package com.bustaudio.app.widget\nclass ListeningWidgetProvider'],
      ['res/xml/bustaudio_listening_widget.xml', 'main/res/xml/bustaudio_listening_widget.xml', '<appwidget-provider />'],
      ['res/layout/bustaudio_listening_widget.xml', 'main/res/layout/bustaudio_listening_widget.xml', '<LinearLayout />'],
      ['test/WidgetPolicyTest.kt', 'test/java/com/bustaudio/app/widget/WidgetPolicyTest.kt', 'package com.bustaudio.app.widget\nclass WidgetPolicyTest'],
    ];
    try {
      for (const [source, , contents] of files) {
        const filename = path.join(assets, source);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, contents);
      }
      const unrelated = path.join(platformProjectRoot, 'app/src/main/res/xml/automotive_app_desc.xml');
      fs.mkdirSync(path.dirname(unrelated), { recursive: true });
      fs.writeFileSync(unrelated, '<automotiveApp />');
      for (let run = 0; run < 2; run += 1) {
        await applyMod('dangerous', {}, { projectRoot, platformProjectRoot });
        for (const [, target, contents] of files) {
          expect(fs.readFileSync(path.join(platformProjectRoot, 'app/src', target), 'utf8')).toBe(contents);
        }
        expect(fs.readFileSync(unrelated, 'utf8')).toBe('<automotiveApp />');
      }
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
