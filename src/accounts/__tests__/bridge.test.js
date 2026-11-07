/* global test, beforeEach */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAccountBridge } from '../bridge';
import { getLibrary, getBook, upsertBook, applyAccountBook } from '../../library';

const book = { id: 'b', title: 'Book', progress: { position: 10 } };
let bridge, records, puts, prefix, secure, pending, currentUser, hangLogout, logoutAborted, hangBody, onClose;
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
beforeEach(async () => {
  await AsyncStorage.clear();
  records = {}; puts = []; pending = null; hangLogout = false; logoutAborted = false; hangBody = false; onClose = null; prefix = 'https://books.test/config'; currentUser = 'alice';
  const values = new Map();
  secure = { getItemAsync: async k => values.get(k) || null, setItemAsync: async (k,v) => values.set(k,v), deleteItemAsync: async k => values.delete(k) };
  bridge = createAccountBridge({ storage: AsyncStorage, secure, getPrefix: async () => prefix,
    getLibrary, applyRemote: applyAccountBook, closePlayback: async () => { if (onClose) await onClose(); }, requestTimeoutMs: 50,
    fetch: async (url, options) => {
      const route = url.split('/app/accounts')[1];
      if (route === '/login' || route === '/register') return reply({ token: 'secret-' + currentUser, user: { id: currentUser, username: currentUser }, expiresAt: Date.now() + 100000 });
      if (route === '/logout') {
        if (hangLogout) return new Promise((_, reject) => options.signal.addEventListener('abort', () => { logoutAborted = true; reject(new Error('aborted')); }));
        return reply({ ok: true });
      }
      if (pending) await pending;
      if (route === '/library') return hangBody ? { ok: true, status: 200, json: () => new Promise(() => {}) } : reply({ books: Object.values(records) });
      const id = decodeURIComponent(route.split('/').pop());
      const body = JSON.parse(options.body); puts.push(body);
      if (body.baseRevision !== (records[id]?.revision || 0)) return reply({ error: 'conflict', record: records[id] }, 409);
      records[id] = { id, revision: body.baseRevision + 1, deleted: !!body.deleted, book: body.book || null };
      return reply({ record: records[id] });
    } });
});
async function login() { await bridge.authenticate('login', { username: currentUser, password: 'password12345' }); }
async function linked() { await login(); await bridge.linkPhone(); }

test('sign in never imports or uploads the existing phone library', async () => {
  await upsertBook(book); await login();
  expect(puts).toEqual([]); expect(records).toEqual({});
  await expect(bridge.sync()).rejects.toThrow(/link/i);
});
test('owner binding survives logout and rejects a different user', async () => {
  await linked(); await bridge.signOut(); currentUser = 'bob'; await login();
  await expect(bridge.linkPhone()).rejects.toThrow(/another account/i);
  await expect(bridge.sync()).rejects.toThrow(/another account/i);
  expect(puts).toEqual([]);
});
test('same account sync pushes only allowed fields and pulls while retaining local files', async () => {
  await upsertBook({ ...book, downloaded: true, storageDir: 'private', files: [{ uri: 'file:///private' }], token: 'credential' });
  await linked(); await bridge.sync();
  expect(puts[0]).toEqual({ baseRevision: 0, book });
  records.b = { id: 'b', revision: 2, deleted: false, book: { ...book, progress: { position: 50 } } };
  await bridge.signOut(); await login(); await bridge.sync();
  expect(await getBook('b')).toMatchObject({ downloaded: true, files: [{ uri: 'file:///private' }], progress: { position: 50 } });
});
test('concurrent changes are visible and resolved with explicit keep-phone CAS', async () => {
  await upsertBook(book); await linked(); await bridge.sync();
  await upsertBook({ id: 'b', progress: { position: 20 } });
  records.b = { id: 'b', revision: 2, deleted: false, book: { ...book, progress: { position: 30 } } };
  const result = await bridge.sync();
  expect(result.conflicts).toHaveLength(1); expect(puts).toHaveLength(1);
  await bridge.resolveConflict('b', 'phone');
  expect(records.b).toMatchObject({ revision: 3, book: { progress: { position: 20 } } });
});
test('cloud tombstones keep offline files without resurrecting on the next sync', async () => {
  await upsertBook({ ...book, downloaded: true, files: [{ uri: 'file:///b' }] });
  await linked(); await bridge.sync();
  records.b = { id: 'b', revision: 2, deleted: true, book: null };
  const result = await bridge.sync();
  expect(result.notices.join(' ')).toMatch(/offline|local copy/i);
  expect(await getBook('b')).toMatchObject({ downloaded: true, files: [{ uri: 'file:///b' }] });
  await bridge.sync(); expect(puts).toHaveLength(1); expect(records.b.deleted).toBe(true);
  await upsertBook({ id: 'b', progress: { position: 90 } });
  expect((await bridge.sync()).conflicts).toHaveLength(1); expect(records.b.deleted).toBe(true);
});
test('logout during in-flight sync prevents local application and further uploads', async () => {
  await linked(); records.b = { id: 'b', revision: 1, deleted: false, book };
  let release; pending = new Promise(r => { release = r; });
  const work = bridge.sync();
  await new Promise(r => setTimeout(r, 0));
  await bridge.signOut(); release();
  await expect(work).rejects.toThrow(/changed|sign in/i);
  expect(await getLibrary()).toEqual({}); expect(puts).toEqual([]); expect(await bridge.status()).toMatchObject({ user: null });
});
test('server change during in-flight sync prevents local application', async () => {
  await linked(); records.b = { id: 'b', revision: 1, deleted: false, book };
  let release; pending = new Promise(r => { release = r; });
  const work = bridge.sync(); await new Promise(r => setTimeout(r, 0));
  prefix = 'https://other.test/config'; release();
  await expect(work).rejects.toThrow(/changed/i); expect(await getLibrary()).toEqual({});
});

test('unsafe server ids are rejected before any library mutation', async () => {
  await linked();
  records.evil = { id: '__proto__', revision: 1, deleted: false, book: { id: '__proto__', title: 'Bad' } };
  await expect(bridge.sync()).rejects.toThrow(/invalid/i);
  expect(await getLibrary()).toEqual({});
});
test('a cloud conflict changed again is shown for review instead of overwritten', async () => {
  await upsertBook(book); await linked(); await bridge.sync();
  await upsertBook({ id: 'b', progress: { position: 20 } });
  records.b = { id: 'b', revision: 2, deleted: false, book: { ...book, progress: { position: 30 } } };
  await bridge.sync();
  records.b = { ...records.b, revision: 3, book: { ...book, progress: { position: 40 } } };
  const result = await bridge.resolveConflict('b', 'phone');
  expect(result.conflicts[0].remote.revision).toBe(3); expect(puts).toHaveLength(1);
});
test('Use cloud replaces metadata including cleared bookmarks while preserving files', async () => {
  await upsertBook({ ...book, downloaded: true, files: [{ uri: 'file:///b' }], rating: 5, bookmarks: [{ createdAt: 1, position: 20 }] });
  await linked(); await bridge.sync();
  await upsertBook({ id: 'b', progress: { position: 20 } });
  records.b = { id: 'b', revision: 2, deleted: false, book: { ...book, progress: { position: 30 } } };
  await bridge.sync(); await bridge.resolveConflict('b', 'cloud');
  const local = await getBook('b');
  expect(local.progress.position).toBe(30); expect(local.rating).toBeUndefined(); expect(local.bookmarks).toBeUndefined();
  expect(local.files).toEqual([{ uri: 'file:///b' }]);
});
test('network timeouts free the sync operation for a later retry', async () => {
  await linked(); pending = new Promise(() => {});
  await expect(bridge.sync()).rejects.toThrow(/timed out/i);
  pending = null;
  expect((await bridge.sync()).conflicts).toEqual([]);
});

test('signout removes credentials promptly and aborts stalled revocation', async () => {
  await linked(); hangLogout = true;
  await bridge.signOut(); expect((await bridge.status()).user).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(logoutAborted).toBe(true);
});
test('response body timeouts cannot hold sync open', async () => {
  await linked(); hangBody = true;
  await expect(bridge.sync()).rejects.toThrow(/timed out/i);
});
test('playback resumed during fetch is closed again and its checkpoint becomes a conflict', async () => {
  await upsertBook(book); await linked(); await bridge.sync();
  records.b = { id: 'b', revision: 2, deleted: false, book: { ...book, progress: { position: 30 } } };
  let closes = 0;
  onClose = async () => { if (++closes === 2) await upsertBook({ id: 'b', progress: { position: 75 } }); };
  const result = await bridge.sync();
  expect(result.conflicts).toHaveLength(1);
  expect((await getBook('b')).progress.position).toBe(75);
});
test('book ids matching inherited properties are treated as normal absent books', async () => {
  await linked(); records.toString = { id: 'toString', revision: 1, deleted: false, book: { id: 'toString', title: 'Book' } };
  const result = await bridge.sync();
  expect(result.conflicts).toEqual([]);
  expect(await getBook('toString')).toMatchObject({ id: 'toString', title: 'Book' });
});
test('long catalogue ids supported by the server can be pulled without truncation', async () => {
  await linked();
  const id = 'book-' + 'a'.repeat(3000);
  records[id] = { id, revision: 1, deleted: false, book: { id, title: 'Long catalogue title' } };
  expect((await bridge.sync()).conflicts).toEqual([]);
  expect((await getBook(id)).title).toBe('Long catalogue title');
});
