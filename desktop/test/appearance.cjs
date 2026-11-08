const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Real renderer and audio; only Electron IPC and the remote audio response are fixtures.
const size = 90 * 8000 * 2, wav = Buffer.alloc(44 + size);
wav.write('RIFF'); wav.writeUInt32LE(size + 36, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size, 40);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://audio.example/**', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }));
    await page.addInitScript(() => {
      const title = 'The Extraordinary Adventures of a Traveller Beyond the Last Lighthouse';
      let state = { configured: true, server: 'books.example', user: { id: 'a', username: 'alice' }, recoveries: [], books: [
        { id: 'a', title, author: 'Mira Lane', saved: true, _revision: 1, bookmarks: [], progress: { position: 12, duration: 90, trackIndex: 0, lastPlayed: 1 } },
        ...['The Quiet Sea', 'A Map of Stars', 'After the Rain', 'The Hidden Garden'].map((title, i) => ({ id: String(i), title, author: 'Rowan Ellis', saved: true, progress: {}, bookmarks: [] })),
      ] };
      let listener, updates = { status: 'idle' };
      window.fixture = { installs: 0, checks: 0, saves: 0, hold: false, release: null,
        emit: value => { updates = value; listener(value); },
        recover: () => { state.recoveries = [{ id: 'a', book: state.books[0], reason: 'offline' }]; },
      };
      window.books = {
        state: async () => structuredClone(state), refresh: async () => structuredClone(state),
        desktopInfo: async () => ({ version: '1.1.0', accent: localStorage.getItem('fixture-accent') || 'violet', updates }),
        setAccent: async key => { localStorage.setItem('fixture-accent', key); return key; },
        onUpdateStatus: callback => { listener = callback; return () => {}; },
        checkForUpdates: async () => { window.fixture.checks++; return { status: 'checking' }; },
        installUpdate: async () => { window.fixture.installs++; return { status: 'installing' }; },
        details: async () => ({ description: 'A story to settle into, wherever you are.' }),
        streams: async () => ({ ready: true, streams: [{ title: 'Chapter One — In Which Our Traveller Discovers the Extraordinary Secret of the Lighthouse Beyond the Sea and Begins a Very Unexpected Journey', url: 'https://audio.example/one.wav' }] }),
        save: async book => { if (window.fixture.hold) await new Promise(resolve => { window.fixture.release = resolve; }); window.fixture.saves++; state.books[0] = { ...book, _revision: book._revision + 1 }; return structuredClone(state); },
      };
    });
    await page.goto('file://' + path.join(__dirname, '../ui/index.html'));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Teal', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.accent === 'teal');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.accent === 'teal');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Teal', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.waitForFunction(() => window.fixture.checks === 1);
    await page.getByText('Checking for updates…', { exact: true }).waitFor();
    await page.evaluate(() => window.fixture.emit({ status: 'error', message: 'The update service is unavailable.' }));
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Your library', exact: true }).click();
    await page.getByRole('button', { name: 'Continue listening', exact: true }).filter({ has: page.locator('svg') }).click();
    await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime >= 12);
    await page.evaluate(() => { window.originalPlayer = document.querySelector('.player'); window.originalSeek = document.querySelector('[aria-label="Listening position"]'); window.fixture.emit({ status: 'downloading', version: '1.2.0', percent: 50 }); window.fixture.emit({ status: 'ready', version: '1.2.0' }); });
    await page.getByText('Update 1.2.0 is ready', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => ({ same: originalPlayer === document.querySelector('.player') && originalSeek === document.querySelector('[aria-label="Listening position"]'), playing: !document.querySelector('audio').paused, installs: window.fixture.installs })), { same: true, playing: true, installs: 0 });
    fs.mkdirSync(path.join(__dirname, '../build'), { recursive: true });
    for (const width of [1280, 920]) {
      await page.setViewportSize({ width, height: 860 });
      await page.locator('.player-caption').focus();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'The minimum window width must not scroll horizontally');
      assert.equal(await page.locator('.player-caption').evaluate(node => node.scrollHeight > node.clientHeight), false, 'Focused chapter titles must be fully readable');
      await page.screenshot({ path: path.join(__dirname, `../build/desktop-refresh-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.screenshot({ path: path.join(__dirname, '../build/desktop-refresh-settings.png'), fullPage: true });
    await page.evaluate(() => { window.fixture.hold = true; });
    await page.locator('.update-card').getByRole('button', { name: 'Restart to update', exact: true }).click();
    await page.waitForFunction(() => window.fixture.release !== null);
    assert.equal(await page.evaluate(() => window.fixture.installs), 0, 'Restart must wait for playback checkpoint');
    assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    assert.equal(await page.evaluate(async () => { await document.querySelector('audio').play().catch(() => {}); return document.querySelector('audio').paused; }), true, 'Playback must stay paused while checkpointing for an update');
    await page.evaluate(() => { window.fixture.hold = false; window.fixture.release(); });
    await page.waitForFunction(() => window.fixture.installs === 1);
    assert.equal(await page.evaluate(async () => { await document.querySelector('audio').play().catch(() => {}); return document.querySelector('audio').paused; }), true, 'Playback must stay paused until the installer closes the app');
    await page.evaluate(() => { window.fixture.recover(); window.fixture.emit({ status: 'ready', version: '1.2.0' }); });
    await page.locator('.update-card').getByRole('button', { name: 'Restart to update', exact: true }).click();
    await page.getByText('Resolve unsaved changes before restarting to update.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.installs), 1, 'Recovery must block restart');
    assert.deepEqual(errors, []);
    console.log('Appearance regression passed: persistent accent, update readiness/checkpoint/recovery, stable playing controls, readable long titles and minimum width.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
