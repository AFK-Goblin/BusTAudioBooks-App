const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const seconds = 90, rate = 8000, size = seconds * rate * 2;
const wav = Buffer.alloc(44 + size);
wav.write('RIFF'); wav.writeUInt32LE(size + 36, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(size, 40);

async function fixture(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://audio.example/**', route => route.fulfill({
    status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }, body: wav,
  }));
  await page.addInitScript(() => {
    let state = {
      configured: true, server: 'books.example', user: { id: 'alice', username: 'alice' }, recoveries: [],
      books: [
        { id: 'a', title: 'First Story', _revision: 1, saved: true, progress: { position: 12, duration: 90, trackIndex: 0 } },
        { id: 'b', title: 'Second Story', _revision: 1, saved: true, progress: { position: 20, duration: 90, trackIndex: 0 } },
      ],
    };
    const pending = new Map(), saves = [];
    window.fixture = {
      get state() { return structuredClone(state); },
      get saves() { return structuredClone(saves); },
      pending: id => pending.has(id),
      release: id => { pending.get(id)({ ready: true, streams: [{ title: 'One part', url: `https://audio.example/${id}.wav` }] }); pending.delete(id); },
      remoteChange: () => { state.books[0] = { ...state.books[0], _revision: 2, progress: { ...state.books[0].progress, position: 60 } }; },
    };
    window.books = {
      state: async () => structuredClone(state), refresh: async () => structuredClone(state),
      details: async () => ({ description: 'A listening race regression fixture.' }),
      streams: id => new Promise(resolve => pending.set(id, resolve)),
      save: async book => {
        saves.push(structuredClone(book));
        const current = state.books.find(item => item.id === book.id);
        if (book._revision !== current._revision) {
          state.recoveries = [{ id: book.id, book, deleted: false, reason: 'conflict' }];
          return { ...structuredClone(state), conflict: true };
        }
        state.books = state.books.map(item => item.id === book.id ? { ...book, _revision: current._revision + 1 } : item);
        return structuredClone(state);
      },
    };
  });
  await page.goto('file://' + path.join(__dirname, '../ui/index.html'));
  return { page, errors };
}
async function choose(page, title, id) {
  await page.getByText(title, { exact: true }).click();
  await page.getByRole('button', { name: 'Listen now', exact: true }).click();
  await page.waitForFunction(value => window.fixture.pending(value), id);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    {
      const { page, errors } = await fixture(browser);
      await choose(page, 'First Story', 'a');
      await page.getByRole('button', { name: 'Close book details' }).click();
      await choose(page, 'Second Story', 'b');
      await page.evaluate(() => window.fixture.release('b'));
      await page.waitForFunction(() => document.querySelector('audio').src.endsWith('/b.wav') && !document.querySelector('audio').paused);
      // Give the deliberately late first response time to settle its media load.
      await page.evaluate(async () => { window.fixture.release('a'); await new Promise(resolve => setTimeout(resolve, 200)); });
      assert.match(await page.locator('audio').getAttribute('src'), /\/b\.wav$/);
      assert.equal(await page.locator('.player-title').textContent(), 'Second Story');
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await fixture(browser);
      await choose(page, 'First Story', 'a');
      await page.getByRole('button', { name: 'Close book details' }).click();
      await page.evaluate(() => window.fixture.remoteChange());
      await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
      await page.evaluate(() => window.fixture.release('a'));
      await page.waitForFunction(() => window.fixture.saves.length > 0);
      assert.equal(await page.evaluate(() => window.fixture.saves[0]._revision), 1, 'An old playback position must keep its original revision');
      await page.getByRole('heading', { name: 'Review unsaved changes' }).waitFor();
      assert.equal(await page.evaluate(() => window.fixture.state.books[0].progress.position), 60);
      assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Playback race regressions passed: late stream selection ignored; refreshed cloud progress protected by original playback revision.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
