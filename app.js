(function () {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const P = window.GymParser;
  const Store = window.GymStore;
  const app = document.getElementById('app');

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = (n) => Math.round(n * 10) / 10;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : NaN; };
  const norm = (s) => String(s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const MEALS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];
  const DEF_SET = { kcal: 2800, p: 120, f: 80, c: 400 };

  const S = {
    tab: 'w', date: P.today(), hist: 'list', histN: 30, statEx: null, statMetric: 'w',
    sheet: null, fd: null, fEdit: null, source: 'local', loadError: null, out: '',
    w: {}, f: {}, lib: [], set: Object.assign({}, DEF_SET),
  };

  // ---------- Telegram helpers ----------
  const ver = (v) => { try { return !!(tg && tg.isVersionAtLeast(v)); } catch (e) { return false; } };
  function haptic(kind) {
    try { if (ver('6.1')) { if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success'); else tg.HapticFeedback.impactOccurred('light'); } } catch (e) { /* ignore */ }
  }
  function ask(msg) {
    return new Promise((res) => {
      if (ver('6.2')) tg.showConfirm(msg, (ok) => res(!!ok));
      else res(window.confirm(msg));
    });
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ---------- сохранение ----------
  const timers = {}, jobs = {};
  function schedule(key, build) {
    jobs[key] = build; clearTimeout(timers[key]);
    timers[key] = setTimeout(() => run(key), 350);
  }
  function run(key) {
    const build = jobs[key]; if (!build) return;
    delete jobs[key]; clearTimeout(timers[key]);
    const v = build();
    if (v == null) Store.remove(key); else Store.set(key, JSON.stringify(v));
  }
  function flushAll() { Object.keys(jobs).forEach(run); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });
  window.addEventListener('pagehide', flushAll);

  const monthKey = (type, d) => type + '_' + d.slice(0, 4) + d.slice(5, 7);
  const wEmpty = (day) => !day || (!day.t && !day.ex.length);
  const fEmpty = (day) => !day || !day.items.length;
  function saveDay(type, d) {
    const ym = d.slice(0, 7);
    schedule(monthKey(type, d), () => {
      const src = S[type], out = {};
      let any = false;
      for (const k in src) {
        if (!k.startsWith(ym)) continue;
        if (type === 'w' ? wEmpty(src[k]) : fEmpty(src[k])) continue;
        out[k] = src[k]; any = true;
      }
      return any ? out : null;
    });
  }
  const saveLib = () => schedule('lib', () => (S.lib.length ? S.lib : null));
  const saveSettings = () => schedule('set', () => S.set);

  function wDay(d, create) { if (!S.w[d] && create) S.w[d] = { t: '', ex: [] }; return S.w[d]; }
  function fDay(d, create) { if (!S.f[d] && create) S.f[d] = { items: [] }; return S.f[d]; }

  // ---------- выборки ----------
  function exNames() {
    const cnt = {}, disp = {};
    for (const d of Object.keys(S.w).sort()) for (const e of S.w[d].ex) {
      if (!e.s.length) continue;
      const k = norm(e.n); cnt[k] = (cnt[k] || 0) + 1; disp[k] = e.n;
    }
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).map((k) => ({ k, n: disp[k], c: cnt[k] }));
  }
  function lastTime(name, before) {
    const key = norm(name);
    const dates = Object.keys(S.w).filter((d) => d < before).sort().reverse();
    for (const d of dates) {
      const e = S.w[d].ex.find((x) => norm(x.n) === key && x.s.length);
      if (e) return { d, e };
    }
    return null;
  }
  function sessions(key) {
    const out = [];
    for (const d of Object.keys(S.w).sort()) {
      const sets = [];
      for (const e of S.w[d].ex) if (norm(e.n) === key) sets.push(...e.s);
      if (sets.length) out.push({ d, s: sets });
    }
    return out;
  }
  function libFind(name) { const k = norm(name); return S.lib.find((x) => norm(x.n) === k); }
  function sumItems(items) {
    const t = { k: 0, p: 0, f: 0, c: 0 };
    for (const it of items) { t.k += it.k || 0; t.p += it.p || 0; t.f += it.f || 0; t.c += it.c || 0; }
    return { k: Math.round(t.k), p: Math.round(t.p), f: Math.round(t.f), c: Math.round(t.c) };
  }
  function refreshLists() {
    $('#exList').innerHTML = exNames().map((x) => `<option value="${esc(x.n)}">`).join('');
    $('#foodList').innerHTML = S.lib.map((x) => `<option value="${esc(x.n)}">`).join('');
  }

  // ---------- общие куски UI ----------
  function dateBar() {
    const d = S.date, t = P.today();
    const rel = d === t ? 'Сегодня' : d === P.addDays(t, -1) ? 'Вчера' : P.weekday(d);
    return `<div class="datebar">
      <button class="arrow" data-act="dprev">‹</button>
      <label class="dlabel"><span>${rel}, ${P.fmtShort(d)}</span><input type="date" id="dPick" value="${d}"></label>
      <button class="arrow" data-act="dnext">›</button>
      ${d !== t ? '<button class="today" data-act="dtoday">Сегодня</button>' : ''}
    </div>`;
  }
  const chipText = ([r, w]) => (w == null ? `<b>${r}</b> раз` : `<b>${r}</b>×${P.fmtNum(w)}кг`);
  function bar(v, max) {
    const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
    return `<div class="bar${v >= max && max > 0 ? ' over' : ''}"><div style="width:${pct.toFixed(1)}%"></div></div>`;
  }

  // ---------- Тренировка ----------
  function vWorkout() {
    const d = S.date, day = wDay(d) || { t: '', ex: [] };
    let h = dateBar();
    h += `<input class="title-in" id="wTitle" placeholder="${esc(P.weekday(d))}" value="${esc(day.t)}" autocomplete="off">`;
    day.ex.forEach((e, i) => {
      const lt = lastTime(e.n, d);
      h += `<div class="card ex">
        <div class="ex-head" data-act="exmenu" data-i="${i}"><span class="ex-name">${esc(e.n)}</span><span class="ex-dots">⋯</span></div>
        <div class="sets">
          ${e.s.map((s, j) => `<button class="chip" data-act="editset" data-i="${i}" data-j="${j}">${chipText(s)}</button>`).join('')}
          <button class="chip add" data-act="addset" data-i="${i}">+ подход</button>
        </div>
        ${e.c ? `<div class="ex-comment">${esc(e.c)}</div>` : ''}
        ${lt ? `<div class="hint">Прошлый раз ${P.fmtShort(lt.d)}: ${esc(P.formatSets(lt.e.s))}</div>` : ''}
      </div>`;
    });
    if (!day.ex.length) h += templatesHtml(d);
    h += `<div class="card"><div class="row">
        <input id="newEx" list="exList" placeholder="Новое упражнение" autocomplete="off" enterkeyhint="done">
        <button class="btn" style="flex:none" data-act="addex">Добавить</button>
      </div></div>
      <details class="card"><summary><b>Вставить текстом</b> <small>— как в «Избранном»</small></summary>
        <textarea id="quick" class="mt" placeholder="Жим лежа - 4х8 25кг&#10;Брусья - 4х20&#10;Махи в стороны - 12 15 15 10 6кг"></textarea>
        <button class="btn mt" style="width:100%" data-act="quickadd">Распознать и добавить</button>
        <div id="quickErr" class="err mt"></div>
      </details>`;
    return h;
  }
  function templatesHtml(d) {
    const ds = Object.keys(S.w).filter((x) => x !== d && S.w[x].ex.some((e) => e.s.length)).sort().reverse().slice(0, 4);
    if (!ds.length) return '<div class="empty">Добавь упражнение ниже или вставь тренировку текстом.<br>Старые записи можно импортировать во вкладке «Ещё».</div>';
    return `<h2>Повторить упражнения из</h2><div class="tmpl">${ds.map((x) => `
      <button class="btn ghost" data-act="tmpl" data-d="${x}">${P.fmtShort(x)} · ${esc(S.w[x].t || P.weekday(x))}<br>
      <small>${esc(S.w[x].ex.map((e) => e.n).join(', '))}</small></button>`).join('')}</div>`;
  }

  function stepper(label, id, val, step, mode, ph) {
    return `<div class="stepper"><label for="${id}">${label}</label>
      <button data-act="step" data-id="${id}" data-v="${-step}">−</button>
      <input id="${id}" inputmode="${mode}" value="${esc(val == null ? '' : val)}" placeholder="${ph || ''}" autocomplete="off">
      <button data-act="step" data-id="${id}" data-v="${step}">+</button></div>`;
  }
  function openSet(i, j) {
    const e = wDay(S.date).ex[i];
    let r = '', w = '';
    if (j != null) [r, w] = e.s[j];
    else if (e.s.length) [r, w] = e.s[e.s.length - 1];
    else { const lt = lastTime(e.n, S.date); if (lt) [r, w] = lt.e.s[0]; }
    S.sheet = { type: 'set', i, j };
    openSheet(`<h3>${esc(e.n)} <small>· подход ${j != null ? j + 1 : e.s.length + 1}</small></h3>
      ${stepper('Повторы', 'sR', r, 1, 'numeric')}
      ${stepper('Вес, кг', 'sW', w == null ? '' : w, 2.5, 'decimal', 'без веса')}
      ${j == null ? stepper('Подходов', 'sN', 1, 1, 'numeric') : ''}
      <div class="row mt">
        ${j != null ? '<button class="btn danger" data-act="setdel">Удалить</button>' : ''}
        <button class="btn" data-act="setsave">${j != null ? 'Сохранить' : 'Добавить'}</button>
      </div>`);
  }
  function openEx(i) {
    const e = wDay(S.date).ex[i];
    S.sheet = { type: 'ex', i };
    openSheet(`<h3>Упражнение</h3>
      <div class="field"><label>Название</label><input id="eN" list="exList" value="${esc(e.n)}" autocomplete="off"></div>
      <div class="field"><label>Заметка</label><textarea id="eC" style="min-height:70px" placeholder="читинг, на пределе, тяжело…">${esc(e.c)}</textarea></div>
      <div class="row">
        <button class="btn ghost" data-act="exup">↑ Выше</button>
        <button class="btn ghost" data-act="exdown">↓ Ниже</button>
        <button class="btn danger" data-act="exdel">Удалить</button>
      </div>
      <button class="btn mt" style="width:100%" data-act="exsave">Сохранить</button>`);
  }

  function addDays(days, replace) {
    let n = 0;
    for (const pd of days) {
      if (replace && pd.ex.length) {
        const old = wDay(pd.d);
        S.w[pd.d] = { t: pd.t || (old && old.t) || '', ex: pd.ex };
      } else {
        const day = wDay(pd.d, true);
        if (!day.t && pd.t) day.t = pd.t;
        day.ex.push(...pd.ex);
      }
      n += pd.ex.length;
      saveDay('w', pd.d);
    }
    return n;
  }

  // ---------- Питание ----------
  function defaultDraft(keep) {
    const hr = new Date().getHours();
    return {
      m: keep ? keep.m : hr < 11 ? 'Завтрак' : hr < 16 ? 'Обед' : 'Ужин',
      n: '', g: '', mode: keep ? keep.mode : '100', k: '', p: '', f: '', c: '', lib: true,
    };
  }
  function calcDraft(fd) {
    const n = fd.n.trim();
    const g = num(fd.g);
    let k = num(fd.k), p = num(fd.p) || 0, f = num(fd.f) || 0, c = num(fd.c) || 0;
    if (!n) return { err: 'Введи название' };
    if (!(k > 0)) k = 4 * p + 9 * f + 4 * c;
    if (!(k > 0)) return { err: 'Укажи калории или БЖУ' };
    const per100 = fd.mode === '100' ? { n, k: Math.round(k), p: r1(p), f: r1(f), c: r1(c) } : null;
    if (fd.mode === '100') {
      if (!(g > 0)) return { err: 'Укажи граммы' };
      const m = g / 100; k *= m; p *= m; f *= m; c *= m;
    }
    return { item: { n, g: g > 0 ? r1(g) : null, k: Math.round(k), p: r1(p), f: r1(f), c: r1(c), m: fd.m }, per100 };
  }
  function frequentFoods() {
    const cnt = {};
    for (const d in S.f) for (const it of S.f[d].items) { const k = norm(it.n); cnt[k] = (cnt[k] || 0) + 1; }
    return S.lib.slice().sort((a, b) => (cnt[norm(b.n)] || 0) - (cnt[norm(a.n)] || 0)).slice(0, 10);
  }
  function vFood() {
    const d = S.date, items = (fDay(d) || { items: [] }).items, t = S.set, T = sumItems(items);
    if (!S.fd) S.fd = defaultDraft();
    const fd = S.fd;
    let h = dateBar();
    const left = T.k < t.kcal ? `осталось ${t.kcal - T.k}` : `+${T.k - t.kcal} сверх цели`;
    const macro = (l, v, m) => `<div><div class="macro-l">${l} <b>${v}</b><small>/${m}</small></div>${bar(v, m)}</div>`;
    h += `<div class="card">
      <div class="kcal-big"><b>${T.k}</b><span class="hint">/ ${t.kcal} ккал</span><span class="grow"></span><small>${left}</small></div>
      ${bar(T.k, t.kcal)}
      <div class="macros">${macro('Белки', T.p, t.p)}${macro('Жиры', T.f, t.f)}${macro('Углев.', T.c, t.c)}</div>
    </div>`;

    if (items.length) {
      for (const meal of MEALS.concat([''])) {
        const list = items.map((it, i) => ({ it, i })).filter((x) => (x.it.m || '') === meal);
        if (!list.length) continue;
        const mt = sumItems(list.map((x) => x.it));
        h += `<div class="card"><div class="meal-h">${meal || 'Без приёма'}<small>${mt.k} ккал · Б ${mt.p}</small></div>`;
        for (const { it, i } of list) {
          h += `<div class="fitem"><div class="grow" data-act="fedit" data-i="${i}">
            <div>${esc(it.n)}${it.g ? ` <small>${P.fmtNum(it.g)} г</small>` : ''}</div>
            <div class="fmac">${it.k} ккал · Б ${P.fmtNum(it.p)} · Ж ${P.fmtNum(it.f)} · У ${P.fmtNum(it.c)}</div></div>
            <button class="x" data-act="fdel" data-i="${i}">✕</button></div>`;
        }
        h += '</div>';
      }
    } else {
      h += '<div class="empty">Пока ничего не записано за этот день</div>';
    }

    const fav = S.fEdit == null ? frequentFoods() : [];
    h += `<h2 id="fFormH">${S.fEdit != null ? 'Изменить запись' : 'Добавить еду'}</h2><div class="card" id="fForm">
      ${fav.length ? `<div class="sets" style="margin:0 0 10px">${fav.map((x) => `<button class="chip" data-act="fquick" data-n="${esc(x.n)}">${esc(x.n)}</button>`).join('')}</div>` : ''}
      <div class="seg" style="margin-bottom:8px">${MEALS.map((m) => `<button data-act="fmeal" data-v="${m}" class="${fd.m === m ? 'on' : ''}">${m}</button>`).join('')}</div>
      <div class="row field">
        <div style="flex:2"><label class="hint">Продукт / блюдо</label><input id="fd-n" list="foodList" value="${esc(fd.n)}" autocomplete="off"></div>
        <div><label class="hint">Граммы</label><input id="fd-g" inputmode="decimal" value="${esc(fd.g)}"></div>
      </div>
      <div class="seg" style="margin-bottom:8px">
        <button data-act="fmode" data-v="100" class="${fd.mode === '100' ? 'on' : ''}">КБЖУ на 100 г</button>
        <button data-act="fmode" data-v="total" class="${fd.mode === 'total' ? 'on' : ''}">КБЖУ всего</button>
      </div>
      <div class="grid4">
        <div><label>Ккал</label><input id="fd-k" inputmode="decimal" value="${esc(fd.k)}" placeholder="авто"></div>
        <div><label>Белки</label><input id="fd-p" inputmode="decimal" value="${esc(fd.p)}"></div>
        <div><label>Жиры</label><input id="fd-f" inputmode="decimal" value="${esc(fd.f)}"></div>
        <div><label>Углев.</label><input id="fd-c" inputmode="decimal" value="${esc(fd.c)}"></div>
      </div>
      <div class="preview" id="fPrev"></div>
      ${fd.mode === '100' ? `<label class="check"><input type="checkbox" id="fd-lib" ${fd.lib ? 'checked' : ''}> Запомнить продукт</label>` : ''}
      <div class="row">
        ${S.fEdit != null ? '<button class="btn ghost" data-act="fcancel">Отмена</button>' : ''}
        <button class="btn" data-act="fsave">${S.fEdit != null ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </div>`;
    return h;
  }
  function updatePreview() {
    const el = $('#fPrev'); if (!el) return;
    const fd = S.fd;
    if (!fd.n && !fd.k && !fd.p && !fd.f && !fd.c) { el.textContent = ''; return; }
    const r = calcDraft(fd);
    el.textContent = r.item ? `= ${r.item.k} ккал · Б ${P.fmtNum(r.item.p)} · Ж ${P.fmtNum(r.item.f)} · У ${P.fmtNum(r.item.c)}` : r.err;
  }
  function fillFromLib(x) {
    Object.assign(S.fd, { n: x.n, mode: '100', k: String(x.k), p: String(x.p), f: String(x.f), c: String(x.c), lib: true, auto: x.n });
  }

  // ---------- История ----------
  function vHistory() {
    let h = `<div class="seg" style="margin-bottom:12px">
      <button data-act="hist" data-v="list" class="${S.hist === 'list' ? 'on' : ''}">Тренировки</button>
      <button data-act="hist" data-v="prog" class="${S.hist === 'prog' ? 'on' : ''}">Прогресс</button>
      <button data-act="hist" data-v="food" class="${S.hist === 'food' ? 'on' : ''}">Питание</button></div>`;
    if (S.hist === 'list') {
      const ds = Object.keys(S.w).filter((d) => S.w[d].ex.some((e) => e.s.length)).sort().reverse();
      if (!ds.length) return h + '<div class="empty">Тренировок пока нет</div>';
      for (const d of ds.slice(0, S.histN)) {
        const day = S.w[d];
        h += `<div class="card hday" data-act="opend" data-d="${d}">
          <div class="hh"><b>${esc(day.t || P.weekday(d))}</b><small>${P.fmtDate(d)}</small></div>
          <pre>${esc(day.ex.filter((e) => e.s.length).map(P.formatExercise).join('\n'))}</pre></div>`;
      }
      if (ds.length > S.histN) h += '<button class="btn ghost" style="width:100%" data-act="more">Показать ещё</button>';
      return h;
    }
    if (S.hist === 'prog') return h + vProgress();
    return h + vFoodHistory();
  }

  function lineChart(pts, unit) {
    if (pts.length < 2) return '<div class="hint" style="padding:10px 0">Для графика нужно хотя бы две тренировки с этим упражнением</div>';
    const W = 340, H = 170, L = 34, R = 10, T = 12, B = 22;
    const ys = pts.map((p) => p.y);
    let mn = Math.min(...ys), mx = Math.max(...ys);
    if (mn === mx) { mn -= 1; mx += 1; }
    const X = (i) => L + ((W - L - R) * i) / (pts.length - 1);
    const Y = (v) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const dots = pts.map((p, i) => `<circle class="dot" cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"><title>${p.x}: ${P.fmtNum(p.y)} ${unit}</title></circle>`).join('');
    const step = Math.max(1, Math.ceil(pts.length / 5));
    const xl = pts.map((p, i) => (i % step === 0 || i === pts.length - 1 ? `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.x}</text>` : '')).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">
      <text x="${L - 4}" y="${Y(mx) + 3}" text-anchor="end">${P.fmtNum(r1(mx))}</text>
      <text x="${L - 4}" y="${Y(mn) + 3}" text-anchor="end">${P.fmtNum(r1(mn))}</text>
      <line x1="${L}" x2="${W - R}" y1="${Y(mn)}" y2="${Y(mn)}" stroke="var(--line)"/>
      <path class="ln" d="${path}"/>${dots}${xl}</svg>`;
  }
  function barChart(pts, target) {
    const W = 340, H = 150, L = 34, R = 6, T = 10, B = 22;
    const mx = Math.max(target || 0, ...pts.map((p) => p.y)) * 1.08 || 1;
    const bw = (W - L - R) / pts.length;
    const Y = (v) => T + (H - T - B) * (1 - v / mx);
    let s = '';
    pts.forEach((p, i) => {
      const x = L + i * bw + bw * 0.15, w = bw * 0.7;
      if (p.y > 0) s += `<rect class="${target && p.y >= target ? 'bro' : 'br'}" x="${x.toFixed(1)}" y="${Y(p.y).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - B - Y(p.y)).toFixed(1)}" rx="2"><title>${p.x}: ${p.y}</title></rect>`;
      if (i % 2 === 0 || pts.length <= 7) s += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${p.x}</text>`;
    });
    if (target) s += `<line class="tgt" x1="${L}" x2="${W - R}" y1="${Y(target).toFixed(1)}" y2="${Y(target).toFixed(1)}"/><text x="${L - 4}" y="${Y(target) + 3}" text-anchor="end">${target}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${s}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/></svg>`;
  }

  function vProgress() {
    const names = exNames();
    if (!names.length) return '<div class="empty">Пока нет данных</div>';
    if (!S.statEx || !names.some((x) => x.k === S.statEx)) S.statEx = names[0].k;
    const ss = sessions(S.statEx);
    const weighted = ss.some((x) => x.s.some(([, w]) => w != null && w > 0));
    let metric = S.statMetric;
    if (!weighted) metric = 'r';
    const metrics = { w: ['Макс. вес', 'кг'], e: ['1ПМ (оценка)', 'кг'], v: ['Объём', 'кг'], r: ['Повторы', 'раз'] };
    const val = (sets) => {
      if (metric === 'w') return Math.max(...sets.map(([, w]) => w || 0));
      if (metric === 'e') return r1(Math.max(...sets.map(([r, w]) => (w || 0) * (1 + r / 30))));
      if (metric === 'v') return sets.reduce((a, [r, w]) => a + r * (w || 0), 0);
      return sets.reduce((a, [r]) => a + r, 0);
    };
    const pts = ss.map((x) => ({ x: P.fmtShort(x.d), y: val(x.s) }));
    const best = pts.length ? Math.max(...pts.map((p) => p.y)) : 0;
    let h = `<div class="card">
      <select id="statEx">${names.map((x) => `<option value="${esc(x.k)}" ${x.k === S.statEx ? 'selected' : ''}>${esc(x.n)} (${x.c})</option>`).join('')}</select>
      ${weighted ? `<div class="seg mt">${Object.keys(metrics).map((k) => `<button data-act="metric" data-v="${k}" class="${metric === k ? 'on' : ''}">${metrics[k][0]}</button>`).join('')}</div>` : ''}
      <div class="stat mt">
        <div><small>Лучший</small><b>${P.fmtNum(best)} ${metrics[metric][1]}</b></div>
        <div><small>Последний</small><b>${pts.length ? P.fmtNum(pts[pts.length - 1].y) : '—'} ${metrics[metric][1]}</b></div>
        <div><small>Тренировок</small><b>${ss.length}</b></div>
      </div>
      <div class="mt">${lineChart(pts.slice(-20), metrics[metric][1])}</div>
    </div>
    <div class="card"><table class="t">${ss.slice().reverse().map((x) => `<tr><td>${P.fmtShort(x.d)}</td><td>${esc(P.formatSets(x.s))}</td></tr>`).join('')}</table></div>`;
    return h;
  }

  function vFoodHistory() {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(P.addDays(P.today(), -i));
    const tot = days.map((d) => ({ d, t: sumItems((fDay(d) || { items: [] }).items) }));
    const filled = tot.filter((x) => x.t.k > 0);
    const avg = (k) => (filled.length ? Math.round(filled.reduce((a, x) => a + x.t[k], 0) / filled.length) : 0);
    return `<div class="card"><b>Калории за 14 дней</b>
        <div class="stat mt"><div><small>В среднем</small><b>${avg('k')}</b></div><div><small>Цель</small><b>${S.set.kcal}</b></div><div><small>Дней с записями</small><b>${filled.length}</b></div></div>
        <div class="mt">${barChart(tot.map((x) => ({ x: P.fmtShort(x.d).slice(0, 2), y: x.t.k })), S.set.kcal)}</div></div>
      <div class="card"><b>Белок, г</b>
        <div class="stat mt"><div><small>В среднем</small><b>${avg('p')}</b></div><div><small>Цель</small><b>${S.set.p}</b></div></div>
        <div class="mt">${barChart(tot.map((x) => ({ x: P.fmtShort(x.d).slice(0, 2), y: x.t.p })), S.set.p)}</div></div>`;
  }

  // ---------- Ещё ----------
  function vMore() {
    const t = S.set;
    const nW = Object.keys(S.w).filter((d) => !wEmpty(S.w[d])).length;
    const nF = Object.keys(S.f).filter((d) => !fEmpty(S.f[d])).length;
    return `<h2>Цели на день</h2><div class="card">
        <div class="grid4">
          <div><label>Ккал</label><input id="setK" inputmode="numeric" value="${t.kcal}"></div>
          <div><label>Белки</label><input id="setP" inputmode="numeric" value="${t.p}"></div>
          <div><label>Жиры</label><input id="setF" inputmode="numeric" value="${t.f}"></div>
          <div><label>Углев.</label><input id="setC" inputmode="numeric" value="${t.c}"></div>
        </div>
        <button class="btn mt" style="width:100%" data-act="saveset">Сохранить цели</button>
      </div>

      <h2>Импорт старых записей</h2><div class="card">
        <div class="hint">В «Избранном» выдели сообщения с тренировками → «Копировать» → вставь сюда. Даты берутся из заголовков вида <i>[04.11.2026 21:00] Айбол: Среда</i>. Если день уже есть — он перезапишется.</div>
        <textarea id="imp" class="mt" placeholder="[04.11.2026 21:00] Айбол: Среда&#10;Жим лежа - 4х8 25кг&#10;…"></textarea>
        <button class="btn mt" style="width:100%" data-act="import">Импортировать</button>
        <div id="impRes" class="mt"></div>
      </div>

      <h2>Экспорт и бэкап</h2><div class="card">
        <div class="row"><button class="btn ghost" data-act="exptext">Тренировки текстом</button><button class="btn ghost" data-act="expjson">Бэкап (JSON)</button></div>
        ${S.out ? `<textarea id="out" class="mt" readonly>${esc(S.out)}</textarea><button class="btn mt" style="width:100%" data-act="copy">Скопировать</button>` : ''}
        <details class="mt"><summary class="hint">Восстановить из бэкапа</summary>
          <textarea id="restore" class="mt" placeholder='{"v":1,...}'></textarea>
          <button class="btn danger mt" style="width:100%" data-act="restore">Заменить все данные бэкапом</button>
        </details>
      </div>

      <h2>Мои продукты (${S.lib.length})</h2><div class="card">
        ${S.lib.length ? S.lib.map((x, i) => `<div class="fitem"><div class="grow"><div>${esc(x.n)}</div><div class="fmac">на 100 г: ${x.k} ккал · Б ${x.p} · Ж ${x.f} · У ${x.c}</div></div><button class="x" data-act="libdel" data-i="${i}">✕</button></div>`).join('')
          : '<div class="hint">Продукты сохраняются сюда, когда добавляешь еду с КБЖУ на 100 г</div>'}
      </div>

      <h2>Хранилище</h2><div class="card">
        <div>${S.source === 'cloud' ? '☁️ Облако Telegram — данные доступны на всех твоих устройствах' : '📱 Только это устройство' + (tg && tg.initData ? '' : ' (приложение открыто не из Telegram)')}</div>
        <div class="hint mt">Дней с тренировками: ${nW} · с питанием: ${nF}${Store.pending ? ` · не синхронизировано: ${Store.pending}` : ''}</div>
        ${S.loadError || Store.lastError ? `<div class="err mt">${esc(S.loadError || Store.lastError)}</div>` : ''}
      </div>`;
  }

  // ---------- рендер ----------
  function render() {
    refreshLists();
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const views = { w: vWorkout, f: vFood, h: vHistory, m: vMore };
    app.innerHTML = views[S.tab]();
    if (S.tab === 'f') updatePreview();
  }

  function openSheet(html) {
    $('#sheetBody').innerHTML = html;
    $('#sheet').hidden = false;
    if (ver('6.1')) tg.BackButton.show();
  }
  function closeSheet() {
    S.sheet = null;
    $('#sheet').hidden = true;
    if (ver('6.1')) tg.BackButton.hide();
  }

  // ---------- действия ----------
  const actions = {
    dprev() { S.date = P.addDays(S.date, -1); S.fEdit = null; render(); },
    dnext() { S.date = P.addDays(S.date, 1); S.fEdit = null; render(); },
    dtoday() { S.date = P.today(); S.fEdit = null; render(); },

    addex() {
      const inp = $('#newEx'); const n = inp.value.trim();
      if (!n) { inp.focus(); return; }
      const day = wDay(S.date, true);
      day.ex.push({ n, s: [], c: '' });
      saveDay('w', S.date); render();
      openSet(day.ex.length - 1, null);
    },
    addset(el) { openSet(+el.dataset.i, null); },
    editset(el) { openSet(+el.dataset.i, +el.dataset.j); },
    step(el) {
      const inp = document.getElementById(el.dataset.id);
      let v = (num(inp.value) || 0) + num(el.dataset.v);
      const min = el.dataset.id === 'sN' ? 1 : 0;
      v = Math.max(min, Math.round(v * 100) / 100);
      inp.value = el.dataset.id === 'sW' && v === 0 ? '' : P.fmtNum(v);
      haptic();
    },
    setsave() {
      const { i, j } = S.sheet; const e = wDay(S.date).ex[i];
      const r = parseInt($('#sR').value, 10);
      const wRaw = $('#sW').value.trim();
      const w = wRaw === '' ? null : num(wRaw);
      if (!(r > 0)) { toast('Укажи количество повторов'); return; }
      if (w !== null && !(w >= 0)) { toast('Вес должен быть числом'); return; }
      if (j != null) e.s[j] = [r, w];
      else { const n = Math.max(1, parseInt($('#sN').value, 10) || 1); for (let k = 0; k < n; k++) e.s.push([r, w]); }
      saveDay('w', S.date); haptic('ok'); closeSheet(); render();
    },
    setdel() {
      const { i, j } = S.sheet; wDay(S.date).ex[i].s.splice(j, 1);
      saveDay('w', S.date); closeSheet(); render();
    },
    exmenu(el) { openEx(+el.dataset.i); },
    exsave() {
      const e = wDay(S.date).ex[S.sheet.i];
      const n = $('#eN').value.trim(); if (n) e.n = n;
      e.c = $('#eC').value.trim();
      saveDay('w', S.date); closeSheet(); render();
    },
    exup() { moveEx(-1); }, exdown() { moveEx(1); },
    async exdel() {
      const day = wDay(S.date), i = S.sheet.i;
      if (!(await ask(`Удалить «${day.ex[i].n}»?`))) return;
      day.ex.splice(i, 1); saveDay('w', S.date); closeSheet(); render();
    },
    tmpl(el) {
      const src = S.w[el.dataset.d], day = wDay(S.date, true);
      if (!day.t) day.t = src.t;
      for (const e of src.ex) day.ex.push({ n: e.n, s: [], c: '' });
      saveDay('w', S.date); render();
    },
    quickadd() {
      const text = $('#quick').value;
      if (!text.trim()) return;
      const r = P.parseText(text, S.date);
      const n = addDays(r.days, false);
      render();
      if (r.errors.length) {
        $('#quick').value = r.errors.join('\n');
        $('#quickErr').textContent = 'Не понял эти строки — поправь и нажми ещё раз (пример: «Жим лежа - 4х8 25кг»)';
        $('#quick').closest('details').open = true;
      }
      if (n) { haptic('ok'); toast(`Добавлено упражнений: ${n}`); }
    },

    // питание
    fmeal(el) { S.fd.m = el.dataset.v; render(); },
    fmode(el) { readFood(); S.fd.mode = el.dataset.v; render(); },
    fquick(el) {
      const x = libFind(el.dataset.n); if (!x) return;
      fillFromLib(x); S.fd.g = ''; render();
      const g = $('#fd-g'); if (g) g.focus();
    },
    fsave() {
      readFood();
      const r = calcDraft(S.fd);
      if (r.err) { toast(r.err); return; }
      const day = fDay(S.date, true);
      if (S.fEdit != null) day.items[S.fEdit] = r.item; else day.items.push(r.item);
      if (r.per100 && S.fd.lib) {
        const ex = libFind(r.per100.n);
        if (ex) Object.assign(ex, r.per100); else S.lib.push(r.per100);
        S.lib.sort((a, b) => a.n.localeCompare(b.n, 'ru'));
        saveLib();
      }
      saveDay('f', S.date);
      S.fEdit = null; S.fd = defaultDraft(S.fd);
      haptic('ok'); render();
    },
    fedit(el) {
      const i = +el.dataset.i, it = fDay(S.date).items[i];
      S.fEdit = i;
      S.fd = { m: it.m || 'Перекус', n: it.n, g: it.g ? String(it.g) : '', mode: 'total', k: String(it.k), p: String(it.p), f: String(it.f), c: String(it.c), lib: false };
      render();
      const h = $('#fFormH'); if (h) h.scrollIntoView({ behavior: 'smooth' });
    },
    fcancel() { S.fEdit = null; S.fd = defaultDraft(S.fd); render(); },
    async fdel(el) {
      const day = fDay(S.date), i = +el.dataset.i;
      if (!(await ask(`Удалить «${day.items[i].n}»?`))) return;
      day.items.splice(i, 1);
      if (S.fEdit === i) { S.fEdit = null; S.fd = defaultDraft(S.fd); }
      saveDay('f', S.date); render();
    },

    // история
    hist(el) { S.hist = el.dataset.v; render(); },
    more() { S.histN += 30; render(); },
    opend(el) { S.date = el.dataset.d; S.tab = 'w'; render(); window.scrollTo(0, 0); },
    metric(el) { S.statMetric = el.dataset.v; render(); },

    // ещё
    saveset() {
      const g = (id, def) => { const v = Math.round(num($(id).value)); return v > 0 ? v : def; };
      S.set = { kcal: g('#setK', DEF_SET.kcal), p: g('#setP', DEF_SET.p), f: g('#setF', DEF_SET.f), c: g('#setC', DEF_SET.c) };
      saveSettings(); haptic('ok'); toast('Цели сохранены'); render();
    },
    import() {
      const text = $('#imp').value;
      if (!text.trim()) return;
      const r = P.parseText(text, P.today());
      const n = addDays(r.days, true);
      const ds = r.days.filter((d) => d.ex.length).map((d) => P.fmtShort(d.d));
      render();
      $('#impRes').innerHTML = `<div>✅ Дней: ${ds.length}, упражнений: ${n}${ds.length ? ` <small>(${ds.join(', ')})</small>` : ''}</div>`
        + (r.errors.length ? `<div class="err mt">Не распознано (${r.errors.length}):\n${esc(r.errors.join('\n'))}</div>` : '');
      if (n) haptic('ok');
    },
    exptext() {
      const ds = Object.keys(S.w).filter((d) => S.w[d].ex.some((e) => e.s.length)).sort();
      S.out = ds.map((d) => P.formatDay(d, S.w[d])).join('\n\n') || 'Тренировок пока нет';
      render();
    },
    expjson() {
      flushAll();
      S.out = JSON.stringify({ v: 1, exported: new Date().toISOString(), w: S.w, f: S.f, lib: S.lib, set: S.set });
      render();
    },
    async copy() {
      const ta = $('#out');
      try { await navigator.clipboard.writeText(S.out); toast('Скопировано'); }
      catch (e) {
        ta.focus(); ta.select();
        try { document.execCommand('copy'); toast('Скопировано'); } catch (e2) { toast('Выдели текст и скопируй вручную'); }
      }
    },
    async restore() {
      let data;
      try { data = JSON.parse($('#restore').value); } catch (e) { toast('Это не похоже на бэкап'); return; }
      if (!data || data.v !== 1 || typeof data.w !== 'object' || typeof data.f !== 'object') { toast('Это не похоже на бэкап'); return; }
      if (!(await ask('Все текущие данные будут заменены бэкапом. Продолжить?'))) return;
      const touched = new Set([...Object.keys(S.w).map((d) => 'w' + d), ...Object.keys(S.f).map((d) => 'f' + d)]);
      S.w = data.w; S.f = data.f; S.lib = Array.isArray(data.lib) ? data.lib : []; S.set = Object.assign({}, DEF_SET, data.set);
      Object.keys(S.w).forEach((d) => touched.add('w' + d));
      Object.keys(S.f).forEach((d) => touched.add('f' + d));
      touched.forEach((x) => saveDay(x[0], x.slice(1)));
      saveLib(); saveSettings(); flushAll();
      S.out = ''; toast('Данные восстановлены'); render();
    },
    async libdel(el) {
      const i = +el.dataset.i;
      if (!(await ask(`Удалить «${S.lib[i].n}» из списка продуктов?`))) return;
      S.lib.splice(i, 1); saveLib(); render();
    },
    sheetclose() { closeSheet(); },
  };

  function moveEx(dir) {
    const day = wDay(S.date), i = S.sheet.i, j = i + dir;
    if (j < 0 || j >= day.ex.length) return;
    [day.ex[i], day.ex[j]] = [day.ex[j], day.ex[i]];
    S.sheet.i = j; saveDay('w', S.date); render(); haptic();
  }
  function readFood() {
    if (!S.fd) return;
    for (const k of ['n', 'g', 'k', 'p', 'f', 'c']) { const el = document.getElementById('fd-' + k); if (el) S.fd[k] = el.value; }
    const lib = document.getElementById('fd-lib'); if (lib) S.fd.lib = lib.checked;
  }

  // ---------- события ----------
  document.addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-tab]');
    if (tab) {
      if (S.tab !== tab.dataset.tab) { S.tab = tab.dataset.tab; S.out = ''; render(); window.scrollTo(0, 0); }
      return;
    }
    const el = ev.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) { ev.preventDefault(); actions[el.dataset.act](el); }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'wTitle') {
      const day = wDay(S.date, true); day.t = t.value.trim(); saveDay('w', S.date);
    } else if (t.id && t.id.startsWith('fd-')) {
      readFood();
      if (t.id === 'fd-n' && S.fEdit == null) {
        const x = libFind(t.value);
        if (!x && S.fd.auto) {
          // имя ушло от продукта из списка — убираем подставленные КБЖУ
          S.fd.auto = null;
          for (const k of ['k', 'p', 'f', 'c']) { S.fd[k] = ''; $('#fd-' + k).value = ''; }
        }
        if (x) {
          fillFromLib(x);
          if (S.fd.mode === '100' && !$('#fd-lib')) { render(); $('#fd-g').focus(); return; }
          for (const k of ['k', 'p', 'f', 'c']) $('#fd-' + k).value = S.fd[k];
          document.querySelectorAll('[data-act="fmode"]').forEach((b) => b.classList.toggle('on', b.dataset.v === '100'));
        }
      }
      updatePreview();
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dPick' && t.value) { S.date = t.value; S.fEdit = null; render(); }
    if (t.id === 'statEx') { S.statEx = t.value; render(); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    if (ev.target.id === 'newEx') { ev.preventDefault(); actions.addex(); }
    else if (S.sheet && S.sheet.type === 'set' && ev.target.tagName === 'INPUT') { ev.preventDefault(); actions.setsave(); }
  });

  // ---------- старт ----------
  async function init() {
    if (tg) {
      document.documentElement.classList.add('tg');
      try { tg.ready(); tg.expand(); } catch (e) { /* ignore */ }
      try { if (ver('7.7')) tg.disableVerticalSwipes(); } catch (e) { /* ignore */ }
      try { if (ver('6.1')) tg.BackButton.onClick(closeSheet); } catch (e) { /* ignore */ }
    }
    const res = await Store.loadAll();
    S.source = res.source; S.loadError = res.error || null;
    for (const k in res.data) {
      let v; try { v = JSON.parse(res.data[k]); } catch (e) { continue; }
      if (/^w_\d{6}$/.test(k)) Object.assign(S.w, v);
      else if (/^f_\d{6}$/.test(k)) Object.assign(S.f, v);
      else if (k === 'lib' && Array.isArray(v)) S.lib = v;
      else if (k === 'set') S.set = Object.assign({}, DEF_SET, v);
    }
    render();
  }

  window.addEventListener('error', (e) => {
    const box = document.createElement('div'); box.className = 'card err';
    box.textContent = 'Ошибка: ' + (e.message || e.error);
    app.prepend(box);
  });

  init();
  window.__gym = S; // для отладки
})();
