import { projectBook, sameBook, isAccountId } from './projection';

const SESSION = 'bustaudio_account_session_v1';
const OWNER = 'bustaudio_account_owner_v1';
const BASELINES = 'bustaudio_account_baselines_v1';
const changed = () => new Error('Account or server changed. Sign in again before syncing.');

// Dependencies keep native credential storage and playback outside the sync
// algorithm, so its isolation and race boundaries can be exercised directly.
export function createAccountBridge(deps) {
  let generation = 0;
  let busy = false;
  let conflicts = new Map();
  let credentialsQueue = Promise.resolve();
  const credentialWrite = fn => {
    const work = credentialsQueue.then(fn, fn);
    credentialsQueue = work.catch(() => {});
    return work;
  };
  const read = async key => JSON.parse(await deps.storage.getItem(key) || 'null');
  const store = (key, value) => deps.storage.setItem(key, JSON.stringify(value));
  const identity = session => ({ origin: new URL(session.prefix).origin, userId: session.user.id });
  const sameOwner = (a, b) => a && b && a.origin === b.origin && a.userId === b.userId;
  async function session() {
    await credentialsQueue;
    const value = JSON.parse(await deps.secure.getItemAsync(SESSION) || 'null');
    return value && value.prefix === await deps.getPrefix() ? value : null;
  }
  async function context() {
    const version = generation;
    const value = await session();
    if (version !== generation) throw changed();
    if (!value) throw new Error('Sign in to your personal library first.');
    return { ...value, generation: version };
  }
  async function guard(ctx) {
    if (generation !== ctx.generation || await deps.getPrefix() !== ctx.prefix || generation !== ctx.generation) throw changed();
  }
  async function timedFetch(url, options, parseBody = true) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Personal library request timed out. Check your connection and try again.'));
        controller.abort();
      }, deps.requestTimeoutMs || 20000);
    });
    const work = (async () => {
      let response;
      try { response = await deps.fetch(url, { ...options, signal: controller.signal }); }
      catch (_) { throw new Error('Could not reach personal libraries. Check your connection and try again.'); }
      if (!parseBody) return { response };
      try { return { response, data: await response.json() }; }
      catch (_) { throw new Error('Personal libraries are not available on this server yet. Offline listening still works.'); }
    })();
    try { return await Promise.race([work, timeout]); }
    finally { clearTimeout(timer); }
  }
  async function request(ctx, route, method = 'GET', body) {
    await guard(ctx);
    const { response, data } = await timedFetch(`${ctx.prefix}/app/accounts${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await guard(ctx);
    if (!response.ok && response.status !== 409) {
      if (response.status === 404 || response.status === 501) throw new Error('Personal libraries are not available on this server yet. Offline listening still works.');
      if (response.status === 401) throw new Error('Sign in again: the session or credentials were rejected.');
      if (response.status === 429) throw new Error('Too many attempts. Wait a little before trying again.');
      throw new Error('Personal library request was rejected. Check your details or invite and try again.');
    }
    return { data, conflict: response.status === 409 };
  }
  async function assertOwner(ctx) {
    const owner = await read(OWNER);
    await guard(ctx);
    if (!owner) throw new Error('Link this phone library before syncing.');
    if (!sameOwner(owner, identity(ctx))) throw new Error('This phone library belongs to another account or server. Sign in to its original account. Switching library owners on this phone is not supported.');
  }
  async function exclusive(fn) {
    if (busy) throw new Error('A personal library operation is already running. Please wait.');
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }
  function recordMap(books) {
    if (!Array.isArray(books)) throw new Error('The server returned an invalid library.');
    const records = new Map();
    for (const record of books) {
      if (!record || !isAccountId(record.id) || !Number.isInteger(record.revision) || record.revision < 1 || typeof record.deleted !== 'boolean' || (!record.deleted && (!record.book || record.book.id !== record.id))) throw new Error('The server returned an invalid library record.');
      if (records.has(record.id)) throw new Error('The server returned duplicate library records.');
      records.set(record.id, { ...record, book: record.deleted ? null : projectBook(record.book) });
    }
    return records;
  }
  function conflict(id, local, remote) {
    const entry = { id, title: local?.title || remote?.book?.title || id, local, remote };
    conflicts.set(id, entry);
    return entry;
  }
  async function saveBaseline(ctx, baselines, id, local, remote) {
    await guard(ctx);
    baselines[id] = { local: projectBook(local), revision: remote.revision, deleted: remote.deleted };
    await store(BASELINES, baselines);
    await guard(ctx);
    conflicts.delete(id);
  }
  async function pull(ctx, baselines, id, local, remote, notices) {
    await deps.closePlayback();
    await guard(ctx);
    const applied = await deps.applyRemote(id, remote, local, () => guard(ctx));
    await guard(ctx);
    if (!applied.applied) { conflict(id, applied.local, remote); return; }
    if (remote.deleted && applied.local) notices.push(`${applied.local.title || id}: removed from the cloud; the offline/local copy is kept on this phone and will not be uploaded again unless you explicitly choose Keep phone.`);
    await saveBaseline(ctx, baselines, id, applied.local, remote);
  }
  async function push(ctx, baselines, id, local, remote) {
    const { data, conflict: collision } = await request(ctx, `/library/${encodeURIComponent(id)}`, 'PUT', {
      baseRevision: remote?.revision || 0, ...(local ? { book: projectBook(local) } : { deleted: true }),
    });
    const saved = recordMap([data.record]).get(id);
    if (!saved) throw new Error('The server returned the wrong library record.');
    if (collision) { conflict(id, local, saved); return; }
    await saveBaseline(ctx, baselines, id, local, saved);
  }
  return {
    async status() {
      const value = await session();
      const owner = await read(OWNER);
      return { user: value?.user || null, owner, linked: !!value && sameOwner(owner, identity(value)) };
    },
    async authenticate(mode, details) {
      if (!['login', 'register'].includes(mode)) throw new Error('Invalid sign-in action.');
      const version = ++generation;
      conflicts = new Map();
      const prefix = await deps.getPrefix();
      if (!prefix) throw new Error('Connect using your install link first.');
      const ctx = { prefix, generation: version };
      const { data } = await request(ctx, `/${mode}`, 'POST', { username: details.username, password: details.password, ...(mode === 'register' ? { invite: details.invite } : {}) });
      if (!data.token || !data.user?.id || !data.user?.username) throw new Error('The server returned an invalid account.');
      await credentialWrite(async () => {
        await guard(ctx);
        await deps.secure.setItemAsync(SESSION, JSON.stringify({ prefix, token: data.token, user: data.user, expiresAt: data.expiresAt }));
      });
      await guard(ctx);
      return this.status();
    },
    async signOut() {
      // Invalidate in-flight work immediately, before any storage/network wait.
      generation++;
      conflicts = new Map();
      let old;
      await credentialWrite(async () => {
        old = JSON.parse(await deps.secure.getItemAsync(SESSION) || 'null');
        await deps.secure.deleteItemAsync(SESSION);
      });
      // Revocation is best effort; never hold local sign-out hostage to network.
      if (old) timedFetch(`${old.prefix}/app/accounts/logout`, { method: 'POST', headers: { Authorization: `Bearer ${old.token}` } }, false).catch(() => {});
    },
    async linkPhone() {
      return exclusive(async () => {
        const ctx = await context();
        const owner = await read(OWNER);
        await guard(ctx);
        if (owner && !sameOwner(owner, identity(ctx))) throw new Error('This phone library belongs to another account or server. Sign in to its original account. Switching library owners on this phone is not supported.');
        if (!owner) await store(OWNER, identity(ctx));
        await guard(ctx);
        return this.status();
      });
    },
    async sync() {
      return exclusive(async () => {
        const ctx = await context();
        await assertOwner(ctx);
        await deps.closePlayback();
        await guard(ctx);
        const { data } = await request(ctx, '/library');
        const remote = recordMap(data.books);
        const library = await deps.getLibrary();
        const baselines = Object.assign(Object.create(null), await read(BASELINES) || {});
        await guard(ctx);
        conflicts = new Map();
        const notices = [];
        for (const id of new Set([...Object.keys(library), ...Object.keys(baselines), ...remote.keys()])) {
          await guard(ctx);
          if (!isAccountId(id)) throw new Error('The phone library contains an invalid book id.');
          const local = projectBook(Object.prototype.hasOwnProperty.call(library, id) ? library[id] : null);
          const base = baselines[id];
          const cloud = remote.get(id);
          if (base && !cloud) throw new Error('The server is missing a previously synced revision. Sync stopped to protect your library.');
          if (!base) {
            if (cloud && local && !sameBook(local, cloud.book)) conflict(id, local, cloud);
            else if (cloud) await pull(ctx, baselines, id, local, cloud, notices);
            else if (local) await push(ctx, baselines, id, local, null);
            continue;
          }
          if (cloud.revision < base.revision) throw new Error('The server library is older than this phone’s last sync. Sync stopped to protect your library.');
          const localChanged = !sameBook(local, base.local);
          const remoteChanged = cloud.revision !== base.revision;
          if (localChanged && (remoteChanged || base.deleted)) conflict(id, local, cloud);
          else if (remoteChanged) await pull(ctx, baselines, id, local, cloud, notices);
          else if (localChanged) await push(ctx, baselines, id, local, cloud);
        }
        return { conflicts: [...conflicts.values()], notices };
      });
    },
    async resolveConflict(id, choice) {
      return exclusive(async () => {
        if (!['phone', 'cloud'].includes(choice)) throw new Error('Choose Keep phone or Use cloud.');
        const ctx = await context(); await assertOwner(ctx);
        const previous = conflicts.get(id);
        if (!previous) throw new Error('Sync again to review this conflict.');
        await deps.closePlayback();
        const { data } = await request(ctx, '/library');
        const remote = recordMap(data.books).get(id);
        const library = await deps.getLibrary();
        const local = projectBook(Object.prototype.hasOwnProperty.call(library, id) ? library[id] : null);
        const baselines = Object.assign(Object.create(null), await read(BASELINES) || {});
        await guard(ctx);
        const notices = [];
        if (!remote) throw new Error('The server is missing this revision. Sync again.');
        if (remote.revision !== previous.remote.revision) {
          conflict(id, local, remote);
          notices.push('The cloud copy changed again. Review the conflict and choose again.');
        } else if (choice === 'phone') await push(ctx, baselines, id, local, remote);
        else await pull(ctx, baselines, id, local, remote, notices);
        return { conflicts: [...conflicts.values()], notices };
      });
    },
  };
}
