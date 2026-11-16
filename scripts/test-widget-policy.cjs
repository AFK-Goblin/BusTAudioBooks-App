#!/usr/bin/env node
/* global __dirname */
// Requires kotlinc, Java, JUNIT_JAR (JUnit 4), and HAMCREST_JAR (Hamcrest Core).
// KOTLINC and JAVA_HOME can select local tools without installing them globally.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const junit = process.env.JUNIT_JAR;
const hamcrest = process.env.HAMCREST_JAR;
if (!junit || !hamcrest || !fs.existsSync(junit) || !fs.existsSync(hamcrest)) {
  console.error('Set JUNIT_JAR and HAMCREST_JAR to local JUnit 4 and Hamcrest Core jars.');
  process.exit(1);
}
const compiler = process.env.KOTLINC || 'kotlinc';
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bustaudio-widget-policy-'));
const jar = path.join(output, 'widget-policy-tests.jar');
const dependencies = [junit, hamcrest].join(path.delimiter);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
let status;
try {
  status = run(compiler, [
    'plugins/android-widget/java/WidgetState.kt',
    'plugins/android-widget/test/WidgetPolicyTest.kt',
    '-classpath', dependencies, '-include-runtime', '-d', jar,
  ]);
  if (status === 0) {
    status = run(java, ['-classpath', [jar, dependencies].join(path.delimiter), 'org.junit.runner.JUnitCore', 'com.bustaudio.app.widget.WidgetPolicyTest']);
  }
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
process.exitCode = status;
