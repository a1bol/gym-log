/* Хранилище: Telegram CloudStorage (привязано к пользователю и боту, синхронизируется между
 * устройствами) + зеркало в localStorage. Значение в CloudStorage ограничено 4096 символами,
 * поэтому длинные значения режутся на куски: key = "~N", key--0 … key--(N-1).
 * Ключей максимум 1024, поэтому данные лежат по месяцам (w_202611, f_202611).
 */
(function (root) {
  'use strict';
  const tg = root.Telegram && root.Telegram.WebApp;
  const MAX = 4000;
  const LS = 'gymlog:';
  const DIRTY = 'gymlog-meta:dirty';

  function cloudAvailable() {
    try {
      return !!(tg && tg.initData && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'));
    } catch (e) { return false; }
  }
  const cs = cloudAvailable() ? tg.CloudStorage : null;
  const call = (method, ...args) => new Promise((resolve, reject) => {
    cs[method](...args, (err, val) => (err ? reject(err) : resolve(val)));
  });

  const chunks = {};            // сколько кусков у ключа сейчас в облаке
  const queues = {};            // последовательная запись по ключу
  let lastError = null;

  function getDirty() { try { return JSON.parse(localStorage.getItem(DIRTY) || '{}'); } catch (e) { return {}; } }
  function setDirty(k, on) {
    const d = getDirty();
    if (on) d[k] = 1; else delete d[k];
    try { localStorage.setItem(DIRTY, JSON.stringify(d)); } catch (e) { /* ignore */ }
  }
  function lsGet(k) { try { return localStorage.getItem(LS + k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, v); } catch (e) { /* ignore */ } }
  function lsDel(k) { try { localStorage.removeItem(LS + k); } catch (e) { /* ignore */ } }
  function lsAll() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS)) out[k.slice(LS.length)] = localStorage.getItem(k);
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  async function cloudWrite(k, v) {
    const n = v.length > MAX ? Math.ceil(v.length / MAX) : 0;
    if (n) {
      for (let j = 0; j < n; j++) await call('setItem', k + '--' + j, v.slice(j * MAX, (j + 1) * MAX));
      await call('setItem', k, '~' + n);
    } else {
      await call('setItem', k, v);
    }
    const extra = [];
    for (let j = n; j < (chunks[k] || 0); j++) extra.push(k + '--' + j);
    if (extra.length) await call('removeItems', extra);
    chunks[k] = n;
  }

  async function cloudRemove(k) {
    const keys = [k];
    for (let j = 0; j < (chunks[k] || 0); j++) keys.push(k + '--' + j);
    await call('removeItems', keys);
    delete chunks[k];
  }

  function enqueue(k, job) {
    const prev = queues[k] || Promise.resolve();
    const next = prev.then(job).then(() => { setDirty(k, false); lastError = null; })
      .catch((e) => { lastError = String(e); console.warn('CloudStorage', k, e); });
    queues[k] = next;
    return next;
  }

  async function loadAll() {
    const local = lsAll();
    if (!cs) return { data: local, source: 'local' };
    try {
      const keys = await call('getKeys');
      const vals = {};
      for (let i = 0; i < keys.length; i += 50) Object.assign(vals, await call('getItems', keys.slice(i, i + 50)));
      const cloud = {};
      for (const k of keys) {
        if (k.includes('--')) continue;
        let v = vals[k] || '';
        const m = /^~(\d+)$/.exec(v);
        if (m) {
          const n = +m[1];
          chunks[k] = n;
          v = '';
          for (let j = 0; j < n; j++) v += vals[k + '--' + j] || '';
        }
        cloud[k] = v;
      }
      // несинхронизированные локальные изменения (были оффлайн) — отправляем в облако
      for (const k of Object.keys(getDirty())) {
        if (local[k] != null) { cloud[k] = local[k]; enqueue(k, () => cloudWrite(k, local[k])); }
        else { delete cloud[k]; enqueue(k, () => cloudRemove(k)); }
      }
      // локальное зеркало = облако
      for (const k in local) if (!(k in cloud)) lsDel(k);
      for (const k in cloud) lsSet(k, cloud[k]);
      return { data: cloud, source: 'cloud' };
    } catch (e) {
      lastError = String(e);
      return { data: local, source: 'local', error: lastError };
    }
  }

  function set(k, v) {
    lsSet(k, v);
    if (!cs) return Promise.resolve();
    setDirty(k, true);
    return enqueue(k, () => cloudWrite(k, v));
  }

  function remove(k) {
    lsDel(k);
    if (!cs) return Promise.resolve();
    setDirty(k, true);
    return enqueue(k, () => cloudRemove(k));
  }

  function flush() { return Promise.all(Object.values(queues)); }

  root.GymStore = {
    loadAll, set, remove, flush, get: lsGet,
    get cloud() { return !!cs; },
    get lastError() { return lastError; },
    get pending() { return Object.keys(getDirty()).length; },
  };
})(window);
