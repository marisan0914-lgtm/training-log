/* TRAINING LOG — personal training record PWA.
 * Data lives in localStorage under KEY. Everything is saved immediately on every change,
 * so closing Safari or reloading never loses in-progress input.
 *
 * Data model (S):
 *   exercises: [{ id, name, type, assist, wStep, hidden, deleted, defaults: { sets: [{w, r, side}], cardio: {dist, speed, time} } }]
 *     - array order = menu order. "deleted" exercises stay in the array so history keeps its link.
 *   sessions: { 'YYYY-MM-DD': { date, mode: 'main'|'light'|null, saved, savedAt, entries: { [exerciseId]: Entry } } }
 *   Entry: { name, type, assist, sets: [{w, r, side}], cardio: {dist, speed, time}|null, done, touched }
 *     - name/type/assist are snapshots so history still renders after an exercise is renamed or deleted.
 */
'use strict';
(() => {
  const KEY = 'traininglog.v1';

  // ---------- utilities ----------
  const $ = (s, el = document) => el.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const WD = '日月火水木金土';
  const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const mdw = s => `${md(s)}(${WD[parseYmd(s).getDay()]})`;
  const longDate = s => { const d = parseYmd(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; };
  const today = () => ymd(new Date());
  let uidN = 0;
  const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = v => Math.round(v * 100) / 100;
  const toNum = v => {
    if (v == null) return null;
    const s = String(v).trim().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(',', '.');
    if (s === '' || isNaN(+s)) return null;
    return round(Math.max(0, +s));
  };
  const fmt = v => (v == null ? '—' : String(round(v)));
  const clone = o => JSON.parse(JSON.stringify(o));

  const TYPES = {
    wr:     { label: '重量 ＋ 回数', weight: true, reps: true },
    r:      { label: '回数のみ', reps: true },
    lrwr:   { label: '左右 ＋ 重量 ＋ 回数', weight: true, reps: true, sides: true },
    lrr:    { label: '左右 ＋ 回数', reps: true, sides: true },
    cardio: { label: '距離 ＋ 速度 ＋ 時間', cardio: true },
    check:  { label: '実施 / 未実施', check: true },
  };
  const typeOf = t => TYPES[t] || TYPES.wr;
  const SIDE = { R: '右', L: '左' };
  const STEP = { r: 1, dist: 0.1, speed: 0.5, time: 1 };

  // ---------- state ----------
  function defaultExercises() {
    const N = (w, r, n) => Array.from({ length: n }, () => ({ w, r }));
    const LR = (w, r, n) => [...Array.from({ length: n }, () => ({ w, r, side: 'R' })), ...Array.from({ length: n }, () => ({ w, r, side: 'L' }))];
    const ex = (name, type, o = {}) => ({
      id: uid(), name, type, assist: !!o.assist, wStep: o.wStep ?? 2.5, hidden: false, deleted: false,
      defaults: { sets: o.sets || [], cardio: o.cardio || null },
    });
    return [
      ex('トレッドミル', 'cardio', { cardio: { dist: 1.5, speed: 12, time: 7.5 } }),
      ex('レッグプレス', 'wr', { wStep: 5, sets: [{ w: 120, r: 7 }, { w: 100, r: 7 }, { w: 100, r: 7 }] }),
      ex('カーフレイズ', 'wr', { sets: N(40, 15, 2) }),
      ex('神輿スクワット', 'lrwr', { sets: LR(50, 20, 2) }),
      ex('アシステッドチンニング', 'wr', { assist: true, sets: N(null, 7, 3) }),
      ex('アシステッドディップス', 'wr', { assist: true, sets: N(null, 7, 3) }),
      ex('シーテッドロー', 'wr', { sets: [{ w: 40, r: 7 }, { w: 40, r: 7 }, { w: 19, r: 15 }] }),
      ex('ケーブルクロスオーバー', 'wr', { sets: N(null, 10, 3) }),
      ex('アームカール', 'wr', { sets: N(null, 10, 3) }),
      ex('ショルダープレス', 'wr', { sets: N(null, null, 3) }),
      ex('腹筋ローラー', 'r', { sets: N(null, 10, 3) }),
      ex('サイドプランク足上げ', 'lrr', { sets: LR(null, 15, 2) }),
      ex('バックレイズ（背筋）', 'r', { sets: N(null, 10, 3) }),
      ex('ダウントレッドミル', 'cardio', { cardio: { dist: 1, speed: null, time: null } }),
      ex('ストレッチ・柔軟', 'check'),
    ];
  }
  const freshState = () => ({ v: 1, exercises: defaultExercises(), sessions: {}, lastBackup: null });
  const validState = s => !!(s && Array.isArray(s.exercises) && s.sessions && typeof s.sessions === 'object');

  let S;
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    S = validState(s) ? s : freshState();
    pruneEmptySessions();
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('保存に失敗しました。バックアップを取ってください'); }
  }

  const isRecorded = e => !!(e && (e.done || e.touched));
  const hasContent = s => !!(s && (s.saved || s.mode || Object.values(s.entries || {}).some(isRecorded)));
  function pruneEmptySessions() {
    const keep = [today(), ui.viewDate];
    for (const d of Object.keys(S.sessions)) if (!keep.includes(d) && !hasContent(S.sessions[d])) delete S.sessions[d];
  }

  const exById = id => S.exercises.find(e => e.id === id);
  const activeExercises = () => S.exercises.filter(e => !e.deleted);
  const visibleExercises = () => activeExercises().filter(e => !e.hidden);
  const exName = (id, entry) => exById(id)?.name || entry?.name || '(不明な種目)';

  function getSession(date, create) {
    let s = S.sessions[date];
    if (!s && create) s = S.sessions[date] = { date, mode: null, saved: false, savedAt: null, entries: {} };
    if (s && !s.entries) s.entries = {};
    return s;
  }

  // Most recent recorded entry for an exercise strictly before `before`.
  function findPrev(exId, before) {
    const ds = Object.keys(S.sessions).filter(d => d < before).sort().reverse();
    for (const d of ds) {
      const e = S.sessions[d].entries?.[exId];
      if (isRecorded(e)) return { date: d, entry: e };
    }
    return null;
  }

  function sortSides(sets, type) {
    if (!typeOf(type).sides) return sets.map(({ w, r }) => ({ w: w ?? null, r: r ?? null }));
    const fixed = sets.map(s => ({ w: s.w ?? null, r: s.r ?? null, side: s.side === 'L' ? 'L' : 'R' }));
    return [...fixed.filter(s => s.side === 'R'), ...fixed.filter(s => s.side === 'L')];
  }

  // New entry for today: copy the previous record (fewest edits), otherwise menu defaults.
  function buildEntry(ex, date) {
    const prev = findPrev(ex.id, date);
    const src = prev && prev.entry.type === ex.type ? prev.entry : null;
    const t = typeOf(ex.type);
    const e = { name: ex.name, type: ex.type, assist: !!ex.assist, sets: [], cardio: null, done: false, touched: false };
    if (t.cardio) e.cardio = clone(src?.cardio || ex.defaults.cardio || { dist: null, speed: null, time: null });
    else if (!t.check) e.sets = sortSides(clone(src?.sets?.length ? src.sets : ex.defaults.sets || []), ex.type);
    return e;
  }

  function ensureEntries(date) {
    const s = getSession(date, true);
    for (const ex of visibleExercises()) if (!s.entries[ex.id]) s.entries[ex.id] = buildEntry(ex, date);
    return s;
  }

  // Drop untouched entries so they regenerate after the menu definition changes.
  function resetUntouched(exId) {
    for (const d of [today(), ui.viewDate]) {
      const e = S.sessions[d]?.entries?.[exId];
      if (e && !isRecorded(e)) delete S.sessions[d].entries[exId];
    }
  }

  // ---------- weekly count / streak ----------
  function weekStart(date) { const d = parseYmd(date); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return ymd(d); }
  function mainCountInWeek(date) {
    const ws = weekStart(date); let n = 0;
    for (let i = 0; i < 7; i++) if (S.sessions[addDays(ws, i)]?.mode === 'main') n++;
    return n;
  }
  function mainStreak(date) { let n = 0, d = date; while (S.sessions[d]?.mode === 'main') { n++; d = addDays(d, -1); } return n; }
  function streakWarning(date) {
    const s = S.sessions[date];
    if (s?.mode === 'main') {
      const n = mainStreak(date);
      if (n >= 3) return `本トレ${n}日連続です。次回は必ず軽めにしましょう`;
      if (n === 2) return '本トレ2日連続です。次回は軽め推奨';
      return '';
    }
    const y = mainStreak(addDays(date, -1));
    if (y >= 2) return `前日まで本トレ${y}日連続です。今日は軽め推奨`;
    return '';
  }

  // ---------- formatting records ----------
  function setText(e, s) {
    const t = typeOf(e.type);
    const side = t.sides ? `${SIDE[s.side] || ''} ` : '';
    if (t.weight) {
      const w = s.w == null ? (e.assist ? 'アシスト—' : '—') : `${e.assist ? 'アシスト' : ''}${fmt(s.w)}kg`;
      return `${side}${w} × ${fmt(s.r)}`;
    }
    return `${side}${fmt(s.r)}回`;
  }
  function cardioText(c) {
    if (!c) return '—';
    return [`${fmt(c.dist)}km`, `${fmt(c.speed)}km/h`, `${fmt(c.time)}分`].join(' · ');
  }
  function entryLines(e) {
    const t = typeOf(e.type);
    if (t.check) return [e.done ? '実施' : '未実施'];
    if (t.cardio) return [cardioText(e.cardio)];
    const n = { R: 0, L: 0, '': 0 };
    return e.sets.map(s => { const k = t.sides ? s.side : ''; n[k]++; return `SET${n[k]}　${setText(e, s)}`; });
  }
  function entryShort(e) {
    const t = typeOf(e.type);
    if (t.check) return e.done ? '実施' : '未実施';
    if (t.cardio) return cardioText(e.cardio);
    return e.sets.map(s => setText(e, s).replace(/ × /g, '×').replace('アシスト', 'A')).join(' / ');
  }

  // ---------- UI state ----------
  const ui = {
    tab: 'today',
    viewDate: null,      // null = today; a date string while editing a past day
    openId: undefined,   // undefined = auto-open first incomplete card
    histMode: 'date', histDay: null, histEx: null,
    growthEx: null, growthMetric: null,
  };
  const view = () => $('#view');
  const curDate = () => ui.viewDate || today();

  function render() {
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    if (ui.tab === 'today') renderToday();
    else if (ui.tab === 'history') renderHistory();
    else if (ui.tab === 'growth') renderGrowth();
    else renderMenu();
  }

  // ---------- TODAY ----------
  function headerHtml(date) {
    const s = getSession(date, true);
    const vis = visibleExercises();
    const done = vis.filter(e => s.entries[e.id]?.done).length;
    const warn = streakWarning(date);
    const editing = date !== today();
    return `
      <div class="brand">TRAINING LOG</div>
      <div class="date">${longDate(date)}</div>
      ${editing ? `<div class="editing"><span>過去の記録を編集中</span><button data-act="backToday">今日に戻る</button></div>` : ''}
      <div class="modes" id="modes">
        <button class="main ${s.mode === 'main' ? 'on' : ''}" data-act="mode" data-mode="main">本トレ</button>
        <button class="light ${s.mode === 'light' ? 'on' : ''}" data-act="mode" data-mode="light">軽め</button>
      </div>
      <div class="stats">
        <div class="stat"><div class="l">今週の本トレ</div><div class="v" id="weekCount">${mainCountInWeek(date)}<small> 回</small></div></div>
        <div class="stat"><div class="l">${editing ? 'この日' : '本日'}</div><div class="v" id="doneCount">${done} / ${vis.length}<small> 種目完了</small></div></div>
      </div>
      ${warn ? `<div class="warnbox" id="warn">⚠ ${esc(warn)}</div>` : ''}`;
  }

  function stepper(label, f, i, v, step) {
    return `<div class="stp">
      <div class="stp-l">${label}</div>
      <div class="stp-c" data-i="${i}" data-f="${f}" data-step="${step}">
        <button data-act="dec" aria-label="${label}を減らす">−</button>
        <input type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" value="${v == null ? '' : round(v)}" placeholder="—" aria-label="${label}">
        <button data-act="inc" aria-label="${label}を増やす">＋</button>
      </div></div>`;
  }

  function cardHtml(ex, idx, date) {
    const s = getSession(date);
    const e = s.entries[ex.id];
    const t = typeOf(ex.type);
    const prev = findPrev(ex.id, date);
    const open = ui.openId === ex.id;
    const sub = e.done ? `今回　${entryShort(e)}` : prev ? `前回 ${md(prev.date)}　${entryShort(prev.entry)}` : '前回記録なし';

    let body = '';
    if (!t.check) {
      body += prev
        ? `<div class="prevbox"><div class="h">前回 ${mdw(prev.date)}</div>${entryLines(prev.entry).map(l => `<div class="ln">${esc(l)}</div>`).join('')}</div>`
        : `<div class="prevbox"><div class="h">前回記録なし（初期値を表示中）</div></div>`;
      body += `<div class="tools"><button class="btn" data-act="copyPrev">前回と同じ</button><button class="btn ghost" data-act="exHist">履歴</button></div>`;
    }
    if (t.cardio) {
      const c = e.cardio || {};
      body += `<div class="set"><div class="stps one">
        ${stepper('距離 (km)', 'dist', -1, c.dist, STEP.dist)}
        ${stepper('速度 (km/h)', 'speed', -1, c.speed, STEP.speed)}
        ${stepper('時間 (分)', 'time', -1, c.time, STEP.time)}
      </div>${c.dist && c.speed ? `<div class="hint">距離÷速度の目安：${round(c.dist / c.speed * 60)}分</div>` : ''}</div>`;
    } else if (!t.check) {
      const n = { R: 0, L: 0, '': 0 };
      e.sets.forEach((st, i) => {
        const k = t.sides ? st.side : ''; n[k]++;
        const wl = ex.assist ? 'アシスト (kg)' : '重量 (kg)';
        body += `<div class="set">
          <div class="set-h"><span>${t.sides ? `<span class="side ${st.side}">${SIDE[st.side]}</span>` : ''}SET${n[k]}</span>
            <button class="xbtn" data-act="delSet" data-i="${i}" aria-label="このセットを削除">✕</button></div>
          <div class="stps ${t.weight ? '' : 'one'}">
            ${t.weight ? stepper(wl, 'w', i, st.w, ex.wStep || 2.5) : ''}
            ${stepper('回数', 'r', i, st.r, STEP.r)}
          </div></div>`;
      });
      if (!e.sets.length) body += `<div class="hint">セットがありません。「＋ SET」で追加してください。</div>`;
      body += t.sides
        ? `<div class="addrow two"><button class="btn" data-act="addSet" data-side="R">＋ 右SET</button><button class="btn" data-act="addSet" data-side="L">＋ 左SET</button></div>`
        : `<div class="addrow"><button class="btn" data-act="addSet">＋ SET</button></div>`;
    }
    if (t.check) {
      body += `<button class="donebtn" data-act="done">${e.done ? '未実施に戻す' : '✓ 実施した'}</button>`;
    } else {
      body += `<button class="donebtn" data-act="done">${e.done ? '完了を取り消す' : '✓ 完了'}</button>`;
    }

    return `<section class="card ${e.done ? 'done' : ''} ${open ? 'open' : ''}" data-ex="${ex.id}" id="card-${ex.id}">
      <button class="card-head" data-act="toggle">
        <span class="badge">${e.done ? '✓' : idx + 1}</span>
        <span class="ttl"><span class="name" style="display:block">${esc(ex.name)}</span><span class="sub" style="display:block">${esc(sub)}</span></span>
        <svg class="chev" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
      </button>
      <div class="card-body">${body}</div>
    </section>`;
  }

  function renderToday() {
    const date = curDate();
    const s = ensureEntries(date);
    save();
    const vis = visibleExercises();
    if (ui.openId === undefined) ui.openId = (vis.find(e => !s.entries[e.id].done) || {}).id || null;
    view().innerHTML = `
      <div id="todayHead">${headerHtml(date)}</div>
      <div id="cards">${vis.length ? vis.map((ex, i) => cardHtml(ex, i, date)).join('') : '<div class="empty">表示中の種目がありません。<br>「メニュー」から追加してください。</div>'}</div>
      <button class="savebtn" data-act="saveDay">${date === today() ? '今日' : 'この日'}のトレーニングを保存</button>
      <div class="savenote">${s.saved ? `保存済み（${new Date(s.savedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）・` : ''}入力内容は自動で一時保存されています</div>`;
  }

  function refreshHead() { const h = $('#todayHead'); if (h) h.innerHTML = headerHtml(curDate()); }
  function refreshCard(exId) {
    const el = $(`#card-${exId}`); if (!el) return;
    const vis = visibleExercises(); const idx = vis.findIndex(e => e.id === exId);
    el.outerHTML = cardHtml(vis[idx], idx, curDate());
  }
  function refreshCards() {
    const date = curDate();
    $('#cards').innerHTML = visibleExercises().map((ex, i) => cardHtml(ex, i, date)).join('');
  }
  function scrollToCard(id) {
    const el = id && $(`#card-${id}`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  function curEntry(target) {
    const card = target.closest('.card');
    if (!card) return {};
    const exId = card.dataset.ex;
    return { exId, ex: exById(exId), entry: getSession(curDate()).entries[exId] };
  }
  function fieldObj(entry, i) {
    if (i < 0) return entry.cardio || (entry.cardio = { dist: null, speed: null, time: null });
    return entry.sets[i];
  }

  function onTodayClick(btn) {
    const act = btn.dataset.act;
    const date = curDate();
    const sess = getSession(date, true);

    if (act === 'mode') {
      const m = btn.dataset.mode;
      sess.mode = sess.mode === m ? null : m;
      save(); refreshHead();
      return;
    }
    if (act === 'backToday') { ui.viewDate = null; ui.openId = undefined; render(); window.scrollTo(0, 0); return; }
    if (act === 'saveDay') {
      if (!sess.mode) {
        toast('先に「本トレ」か「軽め」を選んでください');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const m = $('#modes'); m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1500);
        return;
      }
      sess.saved = true; sess.savedAt = new Date().toISOString(); save();
      const vis = visibleExercises();
      toast(`保存しました（${vis.filter(e => sess.entries[e.id]?.done).length} / ${vis.length}種目完了）`);
      renderToday();
      return;
    }

    const { exId, ex, entry } = curEntry(btn);
    if (!entry) return;

    if (act === 'toggle') {
      ui.openId = ui.openId === exId ? null : exId;
      refreshCards();
      if (ui.openId) scrollToCard(exId);
      return;
    }
    if (act === 'inc' || act === 'dec') {
      const box = btn.closest('.stp-c');
      const i = +box.dataset.i, f = box.dataset.f, step = +box.dataset.step;
      const o = fieldObj(entry, i);
      const cur = o[f] ?? 0;
      o[f] = act === 'inc' ? round(cur + step) : round(Math.max(0, cur - step));
      entry.touched = true; save();
      box.querySelector('input').value = o[f];
      if (i < 0) refreshCard(exId);
      return;
    }
    if (act === 'addSet') {
      const t = typeOf(entry.type);
      const side = btn.dataset.side || null;
      const same = t.sides ? entry.sets.filter(s => s.side === side) : entry.sets;
      const base = same[same.length - 1] || entry.sets[entry.sets.length - 1] || ex.defaults.sets?.[0] || { w: null, r: null };
      const ns = { w: base.w ?? null, r: base.r ?? null };
      if (t.sides) ns.side = side;
      entry.sets.push(ns);
      entry.sets = sortSides(entry.sets, entry.type);
      entry.touched = true; save(); refreshCard(exId);
      return;
    }
    if (act === 'delSet') {
      const i = +btn.dataset.i;
      const removed = entry.sets.splice(i, 1)[0];
      entry.touched = true; save(); refreshCard(exId);
      toast('セットを削除しました', { label: '元に戻す', fn: () => { entry.sets.splice(i, 0, removed); save(); refreshCard(exId); } });
      return;
    }
    if (act === 'copyPrev') {
      const prev = findPrev(exId, date);
      if (!prev) { toast('前回の記録がありません'); return; }
      if (prev.entry.type !== entry.type) { toast('前回と入力タイプが違うためコピーできません'); return; }
      entry.sets = sortSides(clone(prev.entry.sets || []), entry.type);
      if (prev.entry.cardio) entry.cardio = clone(prev.entry.cardio);
      entry.touched = true; save(); refreshCard(exId);
      toast(`前回（${md(prev.date)}）の内容をコピーしました`);
      return;
    }
    if (act === 'exHist') {
      ui.tab = 'history'; ui.histMode = 'ex'; ui.histEx = exId; ui.histDay = null;
      render(); window.scrollTo(0, 0);
      return;
    }
    if (act === 'done') {
      entry.done = !entry.done;
      entry.touched = true;
      if (entry.done) {
        const vis = visibleExercises();
        const from = vis.findIndex(e => e.id === exId);
        const order = [...vis.slice(from + 1), ...vis.slice(0, from)];
        ui.openId = (order.find(e => !getSession(date).entries[e.id]?.done) || {}).id || null;
      } else {
        ui.openId = exId;
      }
      save(); refreshCards(); refreshHead();
      scrollToCard(ui.openId);
      if (entry.done && !ui.openId) toast('全種目完了！「保存」を押してください');
    }
  }

  function onTodayInput(inp) {
    const box = inp.closest('.stp-c'); if (!box) return;
    const { entry } = curEntry(inp); if (!entry) return;
    const o = fieldObj(entry, +box.dataset.i);
    o[box.dataset.f] = toNum(inp.value);
    entry.touched = true; save();
  }

  // ---------- HISTORY ----------
  const modeTag = m => m === 'main' ? '<span class="tag main">本トレ</span>' : m === 'light' ? '<span class="tag light">軽め</span>' : '<span class="tag none">未選択</span>';

  function historyDates() { return Object.keys(S.sessions).filter(d => hasContent(S.sessions[d])).sort().reverse(); }

  // All exercise ids that appear anywhere: menu order first, then ones only in history.
  function allExerciseIds() {
    const ids = activeExercises().map(e => e.id);
    for (const d of Object.keys(S.sessions).sort().reverse())
      for (const [id, e] of Object.entries(S.sessions[d].entries || {}))
        if (isRecorded(e) && !ids.includes(id)) ids.push(id);
    return ids;
  }
  function exRecords(exId) {
    return Object.keys(S.sessions).sort().reverse()
      .map(d => ({ date: d, entry: S.sessions[d].entries?.[exId] }))
      .filter(x => isRecorded(x.entry));
  }

  function renderHistory() {
    let h = '';
    if (ui.histDay) {
      const s = S.sessions[ui.histDay];
      if (!s) { ui.histDay = null; return renderHistory(); }
      const ids = [...activeExercises().map(e => e.id), ...Object.keys(s.entries).filter(id => !activeExercises().some(e => e.id === id))];
      const rec = ids.filter(id => isRecorded(s.entries[id]));
      h += `<button class="back" data-act="hBack">‹ 履歴一覧</button>
        <h2>${longDate(ui.histDay)} ${modeTag(s.mode)}</h2>
        ${rec.length ? rec.map(id => {
          const e = s.entries[id];
          return `<div class="block"><div class="bh"><span class="t">${esc(exName(id, e))}</span>${e.done ? '<span class="tag main">✓ 完了</span>' : '<span class="tag warn">未完了</span>'}</div>
            ${entryLines(e).map(l => `<div class="ln">${esc(l)}</div>`).join('')}
            <button class="linkbtn" data-act="hEx" data-id="${id}">この種目の履歴 ›</button></div>`;
        }).join('') : '<div class="empty">記録された種目はありません</div>'}
        <div class="btngrid" style="margin-top:16px">
          <button class="btn block" data-act="hEdit">この日の記録を編集</button>
          <button class="btn danger block" data-act="hDelDay">この日の記録を削除</button>
        </div>`;
    } else if (ui.histMode === 'ex' && ui.histEx) {
      const recs = exRecords(ui.histEx);
      const ex = exById(ui.histEx);
      h += `<button class="back" data-act="hBack">‹ 種目一覧</button>
        <h2>${esc(exName(ui.histEx, recs[0]?.entry))}</h2>
        ${ex?.assist ? '<div class="note">アシスト重量は少ないほど成長です</div>' : ''}
        ${recs.length ? recs.map(({ date, entry }) => `<div class="block"><div class="bh"><span class="t">${mdw(date)}</span>${modeTag(S.sessions[date].mode)}</div>
          ${entryLines(entry).map(l => `<div class="ln">${esc(l)}</div>`).join('')}${entry.done ? '' : '<div class="small muted">（未完了）</div>'}</div>`).join('')
          : '<div class="empty">まだ記録がありません</div>'}`;
    } else {
      h += `<h2>履歴</h2>
        <div class="seg"><button class="${ui.histMode === 'date' ? 'on' : ''}" data-act="hMode" data-m="date">日付別</button><button class="${ui.histMode === 'ex' ? 'on' : ''}" data-act="hMode" data-m="ex">種目別</button></div>`;
      if (ui.histMode === 'date') {
        const ds = historyDates();
        h += ds.length ? `<div class="list">${ds.map(d => {
          const s = S.sessions[d];
          const n = Object.values(s.entries).filter(e => e.done).length;
          const unsaved = !s.saved ? '<span class="tag warn">未保存</span>' : '';
          return `<button class="row" data-act="hDay" data-d="${d}"><span class="main"><span class="t" style="display:block">${mdw(d)}</span><span class="s" style="display:block">${n}種目 完了</span></span>${unsaved}${modeTag(s.mode)}</button>`;
        }).join('')}</div>` : '<div class="empty">まだ記録がありません</div>';
      } else {
        h += `<div class="list">${allExerciseIds().map(id => {
          const recs = exRecords(id); const ex = exById(id);
          const note = !ex || ex.deleted ? '（メニュー外）' : ex.hidden ? '（非表示中）' : '';
          return `<button class="row" data-act="hEx" data-id="${id}"><span class="main"><span class="t" style="display:block">${esc(exName(id, recs[0]?.entry))}<span class="small muted">${note}</span></span><span class="s" style="display:block">${recs.length ? `記録 ${recs.length}回・最終 ${md(recs[0].date)}` : '記録なし'}</span></span><span class="muted">›</span></button>`;
        }).join('')}</div>`;
      }
    }
    view().innerHTML = h;
  }

  function onHistoryClick(btn) {
    const act = btn.dataset.act;
    if (act === 'hMode') { ui.histMode = btn.dataset.m; ui.histEx = null; }
    else if (act === 'hDay') ui.histDay = btn.dataset.d;
    else if (act === 'hEx') { ui.histMode = 'ex'; ui.histEx = btn.dataset.id; ui.histDay = null; }
    else if (act === 'hBack') { if (ui.histDay) ui.histDay = null; else ui.histEx = null; }
    else if (act === 'hEdit') { ui.viewDate = ui.histDay === today() ? null : ui.histDay; ui.openId = undefined; ui.tab = 'today'; ui.histDay = null; }
    else if (act === 'hDelDay') {
      if (!confirm(`${longDate(ui.histDay)} の記録をすべて削除します。よろしいですか？`)) return;
      delete S.sessions[ui.histDay]; save(); ui.histDay = null; toast('削除しました');
    }
    render(); window.scrollTo(0, 0);
  }

  // ---------- GROWTH ----------
  function metricsFor(ex) {
    const t = typeOf(ex.type);
    if (t.weight) return [
      ex.assist ? { k: 'minw', label: 'アシスト重量', unit: 'kg', better: 'low' } : { k: 'maxw', label: '最大重量', unit: 'kg', better: 'high' },
      { k: 'reps', label: '合計回数', unit: '回', better: 'high' },
      { k: 'sets', label: 'セット数', unit: 'セット', better: 'high' },
    ];
    if (t.reps) return [
      { k: 'reps', label: '合計回数', unit: '回', better: 'high' },
      { k: 'maxr', label: '1セット最大', unit: '回', better: 'high' },
    ];
    if (t.cardio) return [
      { k: 'dist', label: '距離', unit: 'km', better: 'high' },
      { k: 'speed', label: '速度', unit: 'km/h', better: 'high' },
      { k: 'time', label: '時間', unit: '分', better: 'none' },
    ];
    return [];
  }
  function metricValue(e, k) {
    const ws = (e.sets || []).map(s => s.w).filter(v => v != null);
    const rs = (e.sets || []).map(s => s.r).filter(v => v != null);
    switch (k) {
      case 'maxw': return ws.length ? Math.max(...ws) : null;
      case 'minw': return ws.length ? Math.min(...ws) : null;
      case 'reps': return rs.length ? rs.reduce((a, b) => a + b, 0) : null;
      case 'maxr': return rs.length ? Math.max(...rs) : null;
      case 'sets': return e.sets?.length || null;
      default: return e.cardio?.[k] ?? null;
    }
  }

  function chartSvg(pts, invert, unit) {
    const W = 340, H = 200, pl = 44, pr = 16, pt = 16, pb = 30;
    const vals = pts.map(p => p.v);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    let min = lo, max = hi;
    if (min === max) { min -= 1; max += 1; }
    const span = max - min; min -= span * 0.12; max += span * 0.12;
    const x = i => pts.length === 1 ? pl + (W - pl - pr) / 2 : pl + i * (W - pl - pr) / (pts.length - 1);
    const y = v => { const r = (v - min) / (max - min); return invert ? pt + r * (H - pt - pb) : H - pb - r * (H - pt - pb); };
    const ticks = lo === hi ? [lo] : [lo, round((lo + hi) / 2), hi];
    let g = ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#2b2d33"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#9ca3af">${fmt(v)}</text>`).join('');
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    g += `<path d="${path}" fill="none" stroke="#b98cff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="${pts.length > 30 ? 2 : 3.5}" fill="#b98cff"/>`).join('');
    const last = pts[pts.length - 1];
    g += `<text x="${Math.min(x(pts.length - 1), W - pr)}" y="${y(last.v) - 8}" text-anchor="end" font-size="12" font-weight="700" fill="#f3f4f6">${fmt(last.v)}${unit}</text>`;
    g += `<text x="${pl}" y="${H - 8}" font-size="11" fill="#9ca3af">${md(pts[0].date)}</text>`;
    if (pts.length > 1) g += `<text x="${W - pr}" y="${H - 8}" text-anchor="end" font-size="11" fill="#9ca3af">${md(last.date)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="推移グラフ">${g}</svg>`;
  }

  function renderGrowth() {
    const ids = allExerciseIds();
    if (!ids.length) { view().innerHTML = '<h2>成長</h2><div class="empty">種目がありません</div>'; return; }
    if (!ids.includes(ui.growthEx)) {
      ui.growthEx = ids.find(id => { const ex = exById(id); return ex && metricsFor(ex).length && exRecords(id).length; }) || ids[0];
    }
    const id = ui.growthEx;
    const recs = exRecords(id).reverse(); // oldest first
    const ex = exById(id) || { id, name: exName(id, recs[0]?.entry), type: recs[0]?.entry.type || 'wr', assist: !!recs[0]?.entry.assist };
    const ms = metricsFor(ex);
    if (!ms.some(m => m.k === ui.growthMetric)) ui.growthMetric = ms[0]?.k || null;
    const m = ms.find(x => x.k === ui.growthMetric);

    let h = `<h2>成長</h2>
      <label class="field"><span>種目</span><select data-act="gEx">${ids.map(i => `<option value="${i}" ${i === id ? 'selected' : ''}>${esc(exName(i, exRecords(i)[0]?.entry))}</option>`).join('')}</select></label>`;

    if (!m) {
      const n = recs.filter(r => r.entry.done).length;
      const since = addDays(today(), -29);
      const n30 = recs.filter(r => r.entry.done && r.date >= since).length;
      h += `<div class="gstats"><div class="stat"><div class="l">実施回数</div><div class="v">${n}<small>回</small></div></div>
        <div class="stat"><div class="l">直近30日</div><div class="v">${n30}<small>回</small></div></div>
        <div class="stat"><div class="l">最終</div><div class="v">${recs.length ? md(recs[recs.length - 1].date) : '—'}</div></div></div>`;
      view().innerHTML = h; return;
    }

    h += `<div class="chips">${ms.map(x => `<button class="${x.k === m.k ? 'on' : ''}" data-act="gMetric" data-k="${x.k}">${x.label}</button>`).join('')}</div>`;
    const pts = recs.map(r => ({ date: r.date, v: metricValue(r.entry, m.k) })).filter(p => p.v != null);
    const invert = m.better === 'low';
    if (invert) h += `<div class="note">アシスト重量は「少ないほど成長」。グラフは上に行くほど成長（重量が少ない）です。</div>`;
    if (!pts.length) { view().innerHTML = h + '<div class="empty">まだ記録がありません</div>'; return; }

    const first = pts[0].v, last = pts[pts.length - 1].v;
    const best = invert ? Math.min(...pts.map(p => p.v)) : Math.max(...pts.map(p => p.v));
    const diff = round(last - first);
    const good = m.better === 'none' ? null : invert ? diff < 0 : diff > 0;
    const diffTxt = diff === 0 ? '±0' : `${diff > 0 ? '+' : ''}${diff}`;
    h += `<div class="chart">${chartSvg(pts, invert, m.unit)}</div>
      <div class="gstats">
        <div class="stat"><div class="l">初回 → 最新</div><div class="v">${fmt(first)}→${fmt(last)}</div></div>
        <div class="stat"><div class="l">変化</div><div class="v ${good === true ? 'up' : good === false && diff !== 0 ? 'down' : ''}">${diffTxt}<small>${m.unit}</small></div></div>
        <div class="stat"><div class="l">ベスト</div><div class="v">${fmt(best)}<small>${m.unit}</small></div></div>
      </div>
      <div class="section-h">記録（新しい順）</div>
      <div class="list">${pts.slice().reverse().slice(0, 30).map(p => `<div class="row" style="min-height:44px"><span class="main">${mdw(p.date)}</span><b>${fmt(p.v)}${m.unit}</b></div>`).join('')}</div>`;
    view().innerHTML = h;
  }

  // ---------- MENU ----------
  function renderMenu() {
    const act = activeExercises();
    const del = S.exercises.filter(e => e.deleted);
    const nDays = historyDates().length;
    view().innerHTML = `<h2>メニュー編集</h2>
      <div class="small muted" style="margin-bottom:10px">≡ をドラッグ、または ↑↓ で並び替え。種目名をタップで編集。</div>
      <div class="list" id="mlist">${act.map((e, i) => `
        <div class="mitem ${e.hidden ? 'hid' : ''}" data-id="${e.id}">
          <span class="handle" aria-label="ドラッグで並び替え">≡</span>
          <button class="main" data-act="mEdit"><span class="t" style="display:block">${esc(e.name)}</span><span class="s" style="display:block">${typeOf(e.type).label}${e.assist ? '・アシスト' : ''}${e.hidden ? '・非表示中' : ''}</span></button>
          <button class="ibtn eye" data-act="mHide">${e.hidden ? '表示' : '隠す'}</button>
          <button class="ibtn" data-act="mUp" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
          <button class="ibtn" data-act="mDown" ${i === act.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
        </div>`).join('')}</div>
      <button class="btn acc block" style="margin-top:12px;height:52px" data-act="mAdd">＋ 種目を追加</button>
      ${del.length ? `<div class="section-h">削除した種目（履歴は残っています）</div>
        <div class="list">${del.map(e => `<div class="row"><span class="main"><span class="t" style="display:block">${esc(e.name)}</span></span><button class="btn" data-act="mRestore" data-id="${e.id}">戻す</button></div>`).join('')}</div>` : ''}
      <div class="section-h">バックアップ</div>
      <div class="small muted" style="margin-bottom:8px">記録日数：${nDays}日　／　最終バックアップ：${S.lastBackup ? new Date(S.lastBackup).toLocaleDateString('ja-JP') : 'まだありません'}</div>
      <div class="btngrid">
        <button class="btn block" data-act="exportJson">JSONエクスポート（バックアップ保存）</button>
        <button class="btn block" data-act="importJson">JSONインポート（復元）</button>
        <button class="btn block" data-act="exportCsv">CSVエクスポート（Excel用）</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" hidden>
      <div class="small muted" style="margin-top:16px">データはこのiPhoneの中だけに保存されます。月1回程度のJSONバックアップをおすすめします。</div>`;
    bindDrag($('#mlist'));
  }

  function applyOrder(ids) {
    const act = ids.map(exById).filter(Boolean);
    S.exercises = [...act, ...S.exercises.filter(e => !act.includes(e))];
    save();
  }

  function bindDrag(list) {
    list.addEventListener('pointerdown', ev => {
      const h = ev.target.closest('.handle'); if (!h) return;
      ev.preventDefault();
      const item = h.closest('.mitem');
      const before = [...list.children].map(x => x.dataset.id).join();
      try { h.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      item.classList.add('dragging');
      // Move the neighbours, never the dragged item itself: detaching it would drop the pointer capture.
      const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      const move = e => {
        const y = e.clientY;
        let n;
        while ((n = item.nextElementSibling) && y > mid(n)) list.insertBefore(n, item);
        while ((n = item.previousElementSibling) && y < mid(n)) list.insertBefore(n, item.nextElementSibling);
        if (y < 70) window.scrollBy(0, -10); else if (y > innerHeight - 130) window.scrollBy(0, 10);
      };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        item.classList.remove('dragging');
        const ids = [...list.children].map(x => x.dataset.id);
        if (ids.join() !== before) { applyOrder(ids); toast('並び順を変更しました'); }
        renderMenu();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  }

  function onMenuClick(btn) {
    const act = btn.dataset.act;
    const item = btn.closest('.mitem');
    const ex = item ? exById(item.dataset.id) : null;
    if (act === 'mUp' || act === 'mDown') {
      const ids = activeExercises().map(e => e.id);
      const i = ids.indexOf(ex.id), j = act === 'mUp' ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      applyOrder(ids); renderMenu();
      const moved = $(`.mitem[data-id="${ex.id}"] [data-act="${act}"]`);
      if (moved && !moved.disabled) moved.focus({ preventScroll: true });
      return;
    }
    if (act === 'mHide') { ex.hidden = !ex.hidden; save(); renderMenu(); toast(ex.hidden ? `「${ex.name}」を非表示にしました` : `「${ex.name}」を表示しました`); return; }
    if (act === 'mEdit') { openEditor(ex); return; }
    if (act === 'mAdd') { openEditor(null); return; }
    if (act === 'mRestore') { const e = exById(btn.dataset.id); e.deleted = false; e.hidden = false; save(); renderMenu(); toast(`「${e.name}」をメニューに戻しました`); return; }
    if (act === 'exportJson') return exportJson();
    if (act === 'importJson') return $('#importFile').click();
    if (act === 'exportCsv') return exportCsv();
  }

  // ---------- exercise editor (sheet) ----------
  let draft = null, draftIsNew = false;
  function openEditor(ex) {
    draftIsNew = !ex;
    draft = ex ? clone(ex) : {
      id: uid(), name: '', type: 'wr', assist: false, wStep: 2.5, hidden: false, deleted: false,
      defaults: { sets: [{ w: null, r: 10 }, { w: null, r: 10 }, { w: null, r: 10 }], cardio: null },
    };
    renderEditor();
    const sh = $('#sheet'); sh.hidden = false; sh.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
  function closeEditor() { $('#sheet').hidden = true; document.body.style.overflow = ''; draft = null; }

  function renderEditor() {
    const t = typeOf(draft.type);
    const sets = draft.defaults.sets || [];
    const perSide = t.sides ? sets.filter(s => s.side === 'R').length : sets.length;
    const n = { R: 0, L: 0, '': 0 };
    const rows = sets.map((s, i) => {
      const k = t.sides ? s.side : ''; n[k]++;
      return `<div class="drow ${t.weight ? '' : 'noW'}"><span class="lab">${t.sides ? SIDE[s.side] + ' ' : ''}SET${n[k]}</span>
        ${t.weight ? `<label><input inputmode="decimal" data-d="w" data-i="${i}" value="${s.w ?? ''}" placeholder="—"><span class="u">kg</span></label>` : ''}
        <label><input inputmode="decimal" data-d="r" data-i="${i}" value="${s.r ?? ''}" placeholder="—"><span class="u">回</span></label></div>`;
    }).join('');
    const c = draft.defaults.cardio || {};
    $('#sheet').innerHTML = `<div class="inner">
      <div class="sheet-h"><button class="back" data-act="eCancel">‹ 戻る</button><b>${draftIsNew ? '種目を追加' : '種目を編集'}</b><span style="width:60px"></span></div>
      <label class="field"><span>種目名</span><input type="text" data-d="name" value="${esc(draft.name)}" placeholder="例：ラットプルダウン"></label>
      <label class="field"><span>入力タイプ</span><select data-d="type">${Object.entries(TYPES).map(([k, v], i) => `<option value="${k}" ${k === draft.type ? 'selected' : ''}>${'①②③④⑤⑥'[i]} ${v.label}</option>`).join('')}</select></label>
      ${t.weight ? `<label class="check"><input type="checkbox" data-d="assist" ${draft.assist ? 'checked' : ''}>アシスト種目（重量が少ないほど成長）</label>
        <label class="field"><span>＋／− 1回あたりの重量 (kg)</span><input inputmode="decimal" data-d="wStep" value="${draft.wStep ?? 2.5}"></label>` : ''}
      ${t.cardio ? `<div class="section-h">初期値</div>
        <div class="drow"><span class="lab">距離</span><label><input inputmode="decimal" data-d="dist" value="${c.dist ?? ''}" placeholder="—"><span class="u">km</span></label><span></span></div>
        <div class="drow"><span class="lab">速度</span><label><input inputmode="decimal" data-d="speed" value="${c.speed ?? ''}" placeholder="—"><span class="u">km/h</span></label><span></span></div>
        <div class="drow"><span class="lab">時間</span><label><input inputmode="decimal" data-d="time" value="${c.time ?? ''}" placeholder="—"><span class="u">分</span></label><span></span></div>` : ''}
      ${!t.cardio && !t.check ? `<div class="section-h">初期値</div>
        <div class="cnt"><span>${t.sides ? 'セット数（左右それぞれ）' : 'セット数'}</span>
          <div class="stp-c"><button data-act="eCnt" data-v="-1">−</button><input value="${perSide}" readonly><button data-act="eCnt" data-v="1">＋</button></div></div>
        ${rows}` : ''}
      <div class="small muted">※初期値は「前回の記録がない」ときに使われます。前回の記録がある種目は、前回の数値が自動で入ります。</div>
      <label class="check" style="margin-top:8px"><input type="checkbox" data-d="hidden" ${draft.hidden ? 'checked' : ''}>今日の画面に表示しない（一時的に非表示）</label>
      <div class="sheet-actions"><button class="btn ghost" data-act="eCancel">キャンセル</button><button class="btn acc" data-act="eSave">保存</button></div>
      ${draftIsNew ? '' : `<button class="btn danger block" style="margin-top:24px" data-act="eDelete">この種目をメニューから削除</button>
        <div class="small muted" style="margin-top:6px">削除しても過去の記録は残ります（履歴・成長画面で確認できます）。</div>`}
    </div>`;
  }

  function convertDraftType(newType) {
    const oldT = typeOf(draft.type), newT = typeOf(newType);
    let sets = draft.defaults.sets || [];
    if (newT.sides && !oldT.sides) sets = [...sets.map(s => ({ ...s, side: 'R' })), ...sets.map(s => ({ ...s, side: 'L' }))];
    if (!newT.sides && oldT.sides) sets = sets.filter(s => s.side === 'R');
    if (!newT.cardio && !newT.check && !sets.length) sets = [{ w: null, r: 10 }, { w: null, r: 10 }, { w: null, r: 10 }];
    draft.defaults.sets = sortSides(sets, newType);
    if (newT.cardio && !draft.defaults.cardio) draft.defaults.cardio = { dist: null, speed: null, time: null };
    if (!newT.weight) draft.assist = false;
    draft.type = newType;
  }

  function onSheetInput(el) {
    const d = el.dataset.d; if (!d || !draft) return;
    if (d === 'name') draft.name = el.value;
    else if (d === 'type') { convertDraftType(el.value); renderEditor(); }
    else if (d === 'assist' || d === 'hidden') draft[d] = el.checked;
    else if (d === 'wStep') draft.wStep = toNum(el.value);
    else if (['dist', 'speed', 'time'].includes(d)) { draft.defaults.cardio = draft.defaults.cardio || {}; draft.defaults.cardio[d] = toNum(el.value); }
    else if (d === 'w' || d === 'r') draft.defaults.sets[+el.dataset.i][d] = toNum(el.value);
  }

  function onSheetClick(btn) {
    const act = btn.dataset.act;
    if (act === 'eCancel') return closeEditor();
    if (act === 'eCnt') {
      const t = typeOf(draft.type), dv = +btn.dataset.v;
      const adj = list => {
        if (dv > 0) list.push({ ...(list[list.length - 1] || { w: null, r: 10 }) });
        else if (list.length > 1) list.pop();
        return list;
      };
      const sets = draft.defaults.sets;
      draft.defaults.sets = t.sides
        ? [...adj(sets.filter(s => s.side === 'R')).map(s => ({ ...s, side: 'R' })), ...adj(sets.filter(s => s.side === 'L')).map(s => ({ ...s, side: 'L' }))]
        : adj(sets);
      renderEditor(); return;
    }
    if (act === 'eSave') {
      const name = draft.name.trim();
      if (!name) { toast('種目名を入力してください'); return; }
      draft.name = name;
      if (!draft.wStep) draft.wStep = 2.5;
      if (draftIsNew) S.exercises.splice(activeExercises().length, 0, draft);
      else { const i = S.exercises.findIndex(e => e.id === draft.id); S.exercises[i] = draft; }
      resetUntouched(draft.id);
      save(); toast(draftIsNew ? `「${name}」を追加しました` : '保存しました');
      closeEditor(); renderMenu();
      return;
    }
    if (act === 'eDelete') {
      if (!confirm(`「${draft.name}」をメニューから削除しますか？\n（過去の記録は残ります）`)) return;
      const ex = exById(draft.id); ex.deleted = true;
      resetUntouched(ex.id);
      save(); toast(`「${ex.name}」を削除しました`); closeEditor(); renderMenu();
    }
  }

  // ---------- backup ----------
  async function deliverFile(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // iPhone: the share sheet ("ファイルに保存") is the most reliable way to save a file from a home-screen app.
    if (isIOS && navigator.canShare) {
      for (const type of [mime, 'text/plain']) {
        const file = new File([blob], name, { type });
        if (!navigator.canShare({ files: [file] })) continue;
        try { await navigator.share({ files: [file], title: name }); return true; }
        catch (e) { if (e.name === 'AbortError') return false; break; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  async function exportJson() {
    S.lastBackup = new Date().toISOString();
    const ok = await deliverFile(`training-log-backup-${today()}.json`, JSON.stringify(S, null, 1), 'application/json');
    if (ok) { save(); toast('バックアップを書き出しました'); renderMenu(); }
  }
  function exportCsv() {
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['日付', '区分', '種目', '左右', 'セット', '重量kg', '回数', '距離km', '速度kmh', '時間分', '完了']];
    for (const d of Object.keys(S.sessions).sort()) {
      const s = S.sessions[d];
      const mode = s.mode === 'main' ? '本トレ' : s.mode === 'light' ? '軽め' : '';
      for (const [id, e] of Object.entries(s.entries)) {
        if (!isRecorded(e)) continue;
        const name = exName(id, e), done = e.done ? '完了' : '未完了', t = typeOf(e.type);
        if (t.check) rows.push([d, mode, name, '', '', '', '', '', '', '', e.done ? '実施' : '未実施']);
        else if (t.cardio) rows.push([d, mode, name, '', '', '', '', e.cardio?.dist ?? '', e.cardio?.speed ?? '', e.cardio?.time ?? '', done]);
        else {
          const n = { R: 0, L: 0, '': 0 };
          e.sets.forEach(st => { const k = t.sides ? st.side : ''; n[k]++; rows.push([d, mode, name, t.sides ? SIDE[st.side] : '', n[k], st.w ?? '', st.r ?? '', '', '', '', done]); });
        }
      }
    }
    deliverFile(`training-log-${today()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv').then(ok => ok && toast('CSVを書き出しました'));
  }
  function importJsonText(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('ファイルを読み込めませんでした（JSON形式ではありません）'); return false; }
    if (!validState(data)) { toast('このアプリのバックアップファイルではありません'); return false; }
    const days = Object.keys(data.sessions).length;
    if (!confirm(`バックアップ（記録 ${days}日分・種目 ${data.exercises.filter(e => !e.deleted).length}個）で、現在のデータを置き換えます。よろしいですか？`)) return false;
    try { localStorage.setItem(KEY + '.beforeImport', JSON.stringify(S)); } catch (e) { /* best effort */ }
    S = data; ui.viewDate = null; ui.openId = undefined; ui.histDay = null; ui.histEx = null; ui.growthEx = null;
    save(); toast('復元しました'); render();
    return true;
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) t.querySelector('button').onclick = () => { action.fn(); t.classList.remove('show'); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2400);
  }

  // ---------- events ----------
  function bind() {
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]'); if (!b) return;
      const tab = b.dataset.tab;
      if (tab === 'today' && (ui.tab !== 'today' || ui.viewDate)) { ui.viewDate = null; ui.openId = undefined; }
      if (tab === 'history' && ui.tab === 'history') { ui.histDay = null; ui.histEx = null; }
      ui.tab = tab; render(); window.scrollTo(0, 0);
    });
    view().addEventListener('click', e => {
      const btn = e.target.closest('[data-act]'); if (!btn || btn.disabled) return;
      if (ui.tab === 'today') onTodayClick(btn);
      else if (ui.tab === 'history') onHistoryClick(btn);
      else if (ui.tab === 'menu') onMenuClick(btn);
      else if (ui.tab === 'growth' && btn.dataset.act === 'gMetric') { ui.growthMetric = btn.dataset.k; renderGrowth(); }
    });
    view().addEventListener('input', e => { if (ui.tab === 'today' && e.target.matches('.stp-c input')) onTodayInput(e.target); });
    view().addEventListener('change', e => {
      const el = e.target;
      if (ui.tab === 'growth' && el.dataset.act === 'gEx') { ui.growthEx = el.value; ui.growthMetric = null; renderGrowth(); }
      if (ui.tab === 'today' && el.matches('.stp-c input')) {
        onTodayInput(el);
        const v = toNum(el.value); el.value = v == null ? '' : v;
        if (+el.closest('.stp-c').dataset.i < 0) refreshCard(el.closest('.card').dataset.ex);
      }
      if (el.id === 'importFile' && el.files[0]) {
        const r = new FileReader();
        r.onload = () => importJsonText(String(r.result));
        r.readAsText(el.files[0]);
        el.value = '';
      }
    });
    // Select the whole number on tap so typing replaces it.
    view().addEventListener('focusin', e => { if (e.target.matches('.stp-c input')) setTimeout(() => e.target.select(), 0); });
    view().addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });

    const sheet = $('#sheet');
    sheet.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) onSheetClick(b); });
    sheet.addEventListener('input', e => { if (e.target.dataset.d !== 'type') onSheetInput(e.target); });
    sheet.addEventListener('change', e => onSheetInput(e.target));

    // Day rolled over while the app stayed open (e.g. left in background overnight).
    let lastDay = today();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { save(); return; }
      if (today() !== lastDay) { lastDay = today(); ui.openId = undefined; if (!draft) render(); }
    });
    window.addEventListener('pagehide', save);
  }

  // ---------- boot ----------
  load();
  bind();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // Test hook (used only by the automated checks; harmless in normal use).
  window.__tlog = { get state() { return S; }, importJsonText, mainCountInWeek, streakWarning };
})();
