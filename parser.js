/* Парсер и форматтер записей тренировок в формате:
 *   [04.11.2026 21:00] Айбол: Среда
 *   Жим лежа - 4х8 25кг
 *   Жим лежа(30°) - 1х19 20кг 2х10 15кг
 *   Махи в стороны - 12 15 15 10 6кг
 * Подход хранится как [повторы, вес|null].
 */
(function (root) {
  'use strict';

  const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  // ---------- даты (локальные, YYYY-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, '0');
  function toISO(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function today() { return toISO(new Date()); }
  function addDays(s, n) { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d); }
  function weekday(s) { return WEEKDAYS[fromISO(s).getDay()]; }
  function fmtDate(s) { const [y, m, d] = s.split('-'); return d + '.' + m + '.' + y; }
  function fmtShort(s) { const [, m, d] = s.split('-'); return d + '.' + m; }

  const num = (s) => parseFloat(String(s).replace(',', '.'));
  const fmtNum = (n) => (Math.round(n * 100) / 100).toString();

  // ---------- разбор описания подходов ----------
  // "1х12 30кг 2x12 25кг" -> [[12,30],[12,25],[12,25]]
  function parseSpec(spec) {
    const comments = [];
    spec = spec.replace(/\(([^)]*)\)/g, (_, c) => { if (c.trim()) comments.push(c.trim()); return ' '; });

    const re = /(\d+)\s*[хxХX×*]\s*(\d+)|(\d+(?:[.,]\d+)?)\s*(?:кг|kg)|(\d+(?:[.,]\d+)?)/gi;
    const sets = [];
    let pending = [];
    let last = 0;
    let residue = '';
    let m;
    const flush = (w) => { for (const r of pending) sets.push([r, w]); pending = []; };

    while ((m = re.exec(spec))) {
      residue += spec.slice(last, m.index);
      last = re.lastIndex;
      if (m[1] !== undefined) {
        const n = parseInt(m[1], 10), r = parseInt(m[2], 10);
        for (let i = 0; i < n; i++) pending.push(r);
      } else if (m[3] !== undefined) {
        flush(num(m[3]));
      } else {
        pending.push(parseInt(m[4], 10));
      }
    }
    residue += spec.slice(last);
    flush(null);

    const extra = residue.replace(/[\s,;+]+/g, ' ').trim();
    if (/[a-zа-яё]/i.test(extra)) comments.push(extra);
    return { sets, comment: comments.join('; ') };
  }

  // "Жим лежа - 4х8 25кг" -> {n, s, c} | null
  function parseExercise(line) {
    line = line.replace(/^\s*(?:[•·▪︎\-–—*]|\d+[.)])\s+/, '').trim();
    if (!line) return null;
    let m = /^(.*?\S)\s*[-–—]\s+(.*\d.*)$/.exec(line) || /^(.*?\S)\s*[-–—](\d.*)$/.exec(line);
    if (!m) m = /^(.*?[^\d\s])\s+(\d.*)$/.exec(line); // без дефиса: "Брусья 4х20"
    if (!m) return null;
    const name = m[1].replace(/[\s:–—-]+$/, '').trim();
    const { sets, comment } = parseSpec(m[2]);
    if (!name || !sets.length) return null;
    return { n: name, s: sets, c: comment };
  }

  const HEADER = /^\[?(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*(?:[^:\d\n]{1,40}:\s*)?(.*)$/;

  // Весь текст (можно несколько сообщений подряд). Возвращает {days:[{d,t,ex}], errors:[строки]}
  function parseText(text, defaultDate) {
    const days = [];
    const errors = [];
    let cur = null;
    const startDay = (d, t) => { cur = { d, t: t || '', ex: [] }; days.push(cur); };

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const h = HEADER.exec(line);
      if (h) {
        const d = h[3] + '-' + pad(h[2]) + '-' + pad(h[1]);
        const rest = h[4].trim();
        const ex = rest ? parseExercise(rest) : null;
        if (ex) { startDay(d, ''); cur.ex.push(ex); }
        else startDay(d, rest);
        continue;
      }
      const ex = parseExercise(line);
      if (ex) {
        if (!cur) startDay(defaultDate, '');
        cur.ex.push(ex);
      } else if (!/\d/.test(line) && line.length <= 40 && (!cur || !cur.ex.length)) {
        // строка без цифр перед упражнениями — название тренировки ("Среда", "Ноги")
        if (!cur) startDay(defaultDate, line); else cur.t = cur.t || line;
      } else {
        errors.push(line);
      }
    }
    return { days: days.filter((d) => d.ex.length || d.t), errors };
  }

  // ---------- форматирование обратно в текст ----------
  function formatSets(sets) {
    if (!sets || !sets.length) return '';
    const groups = []; // подряд идущие подходы с одинаковым весом
    for (const [r, w] of sets) {
      const g = groups[groups.length - 1];
      if (g && g.w === w) g.reps.push(r); else groups.push({ w, reps: [r] });
    }
    return groups.map((g) => {
      const runs = [];
      for (const r of g.reps) {
        const x = runs[runs.length - 1];
        if (x && x.r === r) x.n++; else runs.push({ r, n: 1 });
      }
      const body = runs.length > 2 ? g.reps.join(' ') : runs.map((x) => x.n + 'х' + x.r).join(' ');
      return g.w == null ? body : body + ' ' + fmtNum(g.w) + 'кг';
    }).join(' ');
  }

  function formatExercise(e) {
    let s = e.n + ' - ' + formatSets(e.s);
    if (e.c) s += ' (' + e.c + ')';
    return s;
  }

  function formatDay(d, day) {
    const lines = ['[' + fmtDate(d) + '] ' + (day.t || weekday(d))];
    for (const e of day.ex) if (e.s.length) lines.push(formatExercise(e));
    return lines.join('\n');
  }

  const api = {
    WEEKDAYS, today, addDays, weekday, fmtDate, fmtShort, fromISO, toISO, fmtNum,
    parseSpec, parseExercise, parseText, formatSets, formatExercise, formatDay,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GymParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
