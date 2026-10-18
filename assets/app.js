/* 信託・期貨證照模擬測驗系統 ─ 主程式
 * 純前端單頁應用：資料來自 data/*.js，作答紀錄存 localStorage，登入 Google 後以 Firebase Firestore 同步。
 */
(function () {
'use strict';

var META = window.__META__ || null;
var BANK = window.__BANK__ || {};
var PAPERS = window.__PAPERS__ || [];
var FB_CONFIG = window.__FIREBASE__ || null;
var app = document.getElementById('app');

var KEY = { ses: 'tfe.session.v1', his: 'tfe.history.v1', wrong: 'tfe.wrong.v1', marks: 'tfe.marks.v1' };
var HIS_MAX = 60, HIS_DETAIL = 30, BANK_PG = 50, WRONG_MAX = 3000;

var S = null;               // 目前的測驗 session
var timerId = null;
var reviewFilter = 'wrong';
var sheetOpen = false;

/* ================= 共用工具 ================= */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmtTxt(s) { return esc(s).replace(/；(?!\s*$)/g, '；<br>'); }
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function fmtDate(ts) {
  var d = new Date(ts);
  function p(n) { return n < 10 ? '0' + n : n; }
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
var store = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function L(i) { return 'ABCD'.charAt(i); }
function fill(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
function examById(id) { return (META && META.exams || []).filter(function (e) { return e.id === id; })[0] || null; }
function hueCls(e) { return 'hue-' + ((e && e.hue) || 'trust'); }
function bookLabel(s) { return String(s || '').replace(/^.*?題庫｜/, '').replace(/^.*?題庫$/, '') || String(s || ''); }

/* ================= 題庫存取 ================= */
function bankOf(id) { return BANK[id] || []; }
/* 題目來源：book＝書籍題庫（依章節）／off＝官方歷屆試題／self＝自編詳解題 */
function kindOf(q) {
  if (q.kind) return q.kind;
  if (/題庫/.test(q.subject || '')) return 'book';
  var ex = q.explain || q.exps;
  if (!ex || ex.every(function (x) { return !x; })) return 'off';
  return 'self';
}
function poolOf(id, src) {
  var all = bankOf(id);
  if (src === 'off') return all.filter(function (q) { return kindOf(q) === 'off'; });
  if (src === 'book') return all.filter(function (q) { return kindOf(q) === 'book'; });
  return all;
}
function srcName(src) { return src === 'off' ? '官方歷屆試題' : (src === 'book' ? '書籍題庫' : ''); }
function papersOf(id) { return PAPERS.filter(function (p) { return p.exam === id; }); }
function paperById(pid) { return PAPERS.filter(function (p) { return p.id === pid; })[0] || null; }

/* 全域索引：題庫題目＋歷屆試卷題目（題號 = 試卷id#序號） */
var _IDX = null;
function rawById(id) {
  if (!_IDX) {
    _IDX = {};
    Object.keys(BANK).forEach(function (k) { BANK[k].forEach(function (q) { _IDX[q.id] = q; }); });
    PAPERS.forEach(function (p) {
      p.questions.forEach(function (q, i) { _IDX[p.id + '#' + (i + 1)] = paperRaw(p, q, i); });
    });
  }
  return _IDX[id] || null;
}
function paperRaw(p, q, i) {
  return { id: p.id + '#' + (i + 1), exam: p.exam, subject: '', topic: '官方題庫 ─ ' + p.yCE + ' 年', kind: 'off', difficulty: 2,
    q: q.q, options: q.options, answer: q.answer, explain: ['', '', '', ''], note: q.note || '',
    src: p.examName + ' ' + p.label + '（民國 ' + p.yROC + ' 年／西元 ' + p.yCE + ' 年）' };
}

/* 原始題目 → 作答用題目（可打散選項；perm[i] = 第 i 個顯示選項對應的原始索引） */
function toItem(raw, keepOrder) {
  var perm = keepOrder ? [0, 1, 2, 3] : shuffle([0, 1, 2, 3]);
  return {
    id: raw.id, exam: raw.exam || '', subject: raw.subject || '', topic: raw.topic || '綜合', kind: kindOf(raw),
    q: raw.q, opts: perm.map(function (i) { return raw.options[i]; }),
    exps: perm.map(function (i) { return (raw.explain && raw.explain[i]) || ''; }),
    ans: perm.indexOf(raw.answer), src: raw.src || '', note: raw.note || '', perm: perm
  };
}
/* 顯示用（原始順序，不打散） */
function viewOf(raw) { return toItem(raw, true); }

function normKey(q) { return String(q.q).replace(/\s/g, '').slice(0, 60) + '|' + (q.options || []).join('|').replace(/\s/g, ''); }
/* 同一份試卷不出現重複題（書籍題庫與歷屆題常有相同題目） */
function dedup(pool) {
  var seen = {};
  return pool.filter(function (q) { var k = normKey(q); if (seen[k]) return false; seen[k] = 1; return true; });
}
/* 依主題比例分層隨機抽題 */
function stratified(pool, n) {
  if (n >= pool.length) return shuffle(pool);
  var by = {}, keys = [];
  pool.forEach(function (q) { var t = q.topic || '綜合'; if (!by[t]) { by[t] = []; keys.push(t); } by[t].push(q); });
  var quota = {}, rem = [], used = 0;
  keys.forEach(function (t) {
    by[t] = shuffle(by[t]);
    var exact = n * by[t].length / pool.length;
    quota[t] = Math.floor(exact); used += quota[t];
    rem.push([t, exact - quota[t]]);
  });
  rem.sort(function (a, b) { return b[1] - a[1]; });
  for (var i = 0; used < n && i < rem.length; i++, used++) quota[rem[i][0]]++;
  var out = [];
  keys.forEach(function (t) { out = out.concat(by[t].slice(0, quota[t])); });
  return shuffle(out).slice(0, n);
}
/* 一般抽題：有 splits 時先依子科目配額，再分層 */
function drawQuestions(exam, n, opt) {
  opt = opt || {};
  var pool = poolOf(exam.id, opt.src || 'all');
  if (opt.topics && opt.topics.length) pool = pool.filter(function (q) { return opt.topics.indexOf(q.topic) >= 0; });
  pool = dedup(pool);
  var qs;
  if (opt.ordered) qs = pool.slice(0, n);
  else if (!opt.topics && exam.splits && exam.splits.length) {
    var total = exam.splits.reduce(function (s, p) { return s + p.n; }, 0), scale = Math.min(1, n / total);
    qs = [];
    exam.splits.forEach(function (p) {
      qs = qs.concat(stratified(pool.filter(function (q) { return q.subject === p.subject; }), Math.round(p.n * scale)));
    });
  } else qs = stratified(pool, n);
  return qs.map(function (q) { return toItem(q, !!opt.ordered); });
}
/* 書籍題庫：依歷屆各章節出題比例（meta.chw）抽一份模擬卷 */
function drawWeighted(examId, n) {
  var e = examById(examId), W = (e && e.chw) || [], pool = dedup(poolOf(examId, 'book'));
  if (!W.length) return stratified(pool, n).map(function (q) { return toItem(q); });
  var byK = {};
  pool.forEach(function (q) { var k = (q.subject || '') + '||' + q.topic; (byK[k] = byK[k] || []).push(q); });
  var quota = W.map(function (w) {
    var k = w.s + '||' + w.t, avail = (byK[k] || []).length, exact = n * w.p / 100;
    return { k: k, n: Math.min(avail, Math.floor(exact)), rem: exact - Math.floor(exact), avail: avail };
  });
  var used = quota.reduce(function (s, x) { return s + x.n; }, 0);
  quota.sort(function (a, b) { return b.rem - a.rem; });
  for (var i = 0; used < n && i < quota.length * 4; i++) { var x = quota[i % quota.length]; if (x.n < x.avail) { x.n++; used++; } }
  var picked = [], seen = {};
  function take(q) { var k = normKey(q); if (seen[k]) return false; seen[k] = 1; picked.push(q); return true; }
  quota.forEach(function (x) { var got = 0; shuffle(byK[x.k] || []).forEach(function (q) { if (got < x.n && take(q)) got++; }); });
  shuffle(pool).forEach(function (q) { if (picked.length < n) take(q); });
  return shuffle(picked).slice(0, n).map(function (q) { return toItem(q); });
}
/* 書籍題庫章節清單（依題庫原順序） */
function bookChapters(id) {
  var out = [], idx = {};
  poolOf(id, 'book').forEach(function (q) {
    var k = (q.subject || '') + '||' + q.topic;
    if (idx[k] == null) { idx[k] = out.length; out.push({ subject: q.subject || '', topic: q.topic, n: 0 }); }
    out[idx[k]].n++;
  });
  return out;
}

/* ================= 收藏／錯題本 ================= */
function getMarks() { return store.get(KEY.marks, []); }
function isMarked(id) { return getMarks().some(function (m) { return m.id === id; }); }
/* 收藏一律存原始選項順序，換題庫版本後仍可還原 */
function snapshot(item) {
  var raw = rawById(item.id);
  if (raw) return { id: raw.id, exam: raw.exam || item.exam, subject: raw.subject || '', topic: raw.topic || '', kind: kindOf(raw),
    q: raw.q, opts: raw.options.slice(), ans: raw.answer, exps: (raw.explain || ['', '', '', '']).slice(), src: raw.src || '', note: raw.note || '', ts: Date.now() };
  var perm = item.perm || [0, 1, 2, 3], o = [], x = [];
  perm.forEach(function (orig, i) { o[orig] = item.opts[i]; x[orig] = item.exps[i]; });
  return { id: item.id, exam: item.exam, subject: item.subject, topic: item.topic, kind: item.kind, q: item.q, opts: o, ans: perm[item.ans], exps: x, src: item.src, note: item.note, ts: Date.now() };
}
function toggleMark(item) {
  var marks = getMarks(), i = -1;
  marks.forEach(function (m, k) { if (m.id === item.id) i = k; });
  if (i >= 0) marks.splice(i, 1); else marks.push(snapshot(item));
  store.set(KEY.marks, marks); updateFab(); scheduleSync();
  return i < 0;
}
function markRaw(m) { return rawById(m.id) || { id: m.id, exam: m.exam, subject: m.subject, topic: m.topic, kind: m.kind, q: m.q, options: m.opts, answer: m.ans, explain: m.exps, src: m.src, note: m.note }; }

function getWrong() { return store.get(KEY.wrong, []); }
function wrongActive(examId) {
  return getWrong().filter(function (x) { return x.exam === examId && (!x.r || x.w > x.r) && rawById(x.id); });
}
function wrongFromHistory(examId, n) {
  var recs = store.get(KEY.his, []).filter(function (r) { return r.examId === examId && r.detail && r.detail.length; }).slice(0, n);
  var seen = {}, out = [];
  recs.forEach(function (r) {
    r.detail.forEach(function (d) {
      var raw = rawById(d.id); if (!raw || seen[d.id]) return;
      var p = (d.p && d.p.length === 4) ? d.p : [0, 1, 2, 3];
      if (d.k !== p.indexOf(raw.answer)) { seen[d.id] = 1; out.push(raw); }
    });
  });
  return out;
}
function mergeWrong(list) {
  var m = {};
  getWrong().concat(list || []).forEach(function (x) {
    if (!x || !x.id) return;
    var f = m[x.id];
    if (!f) m[x.id] = { id: x.id, exam: x.exam, w: x.w || 0, r: x.r || 0 };
    else { f.w = Math.max(f.w, x.w || 0); f.r = Math.max(f.r, x.r || 0); }
  });
  store.set(KEY.wrong, Object.keys(m).map(function (k) { var x = m[k]; if (!x.r) delete x.r; return x; }));
}
function mergeBy(key, a, b) {
  var seen = {}, out = [];
  (a || []).concat(b || []).forEach(function (x) { if (x && x[key] != null && !seen[x[key]]) { seen[x[key]] = 1; out.push(x); } });
  return out;
}

/* ================= Session ================= */
function makeSession(examId, mode, qs, extra) {
  var e = examById(examId);
  S = { examId: examId, mode: mode, qs: qs, picked: fill(qs.length, null), flags: fill(qs.length, false), shown: fill(qs.length, false),
    idx: 0, total: qs.length, startTs: Date.now(), done: false,
    limitMin: mode === 'mock' ? e.min : null, deadline: mode === 'mock' ? Date.now() + e.min * 60000 : null };
  Object.keys(extra || {}).forEach(function (k) { S[k] = extra[k]; });
  saveSession(); vExam();
}
function saveSession() { if (S && !S.done) store.set(KEY.ses, S); }
function answered() { return S.picked.filter(function (p) { return p != null; }).length; }
function submit(auto) {
  clearInterval(timerId); timerId = null;
  var e = examById(S.examId), correct = 0;
  S.qs.forEach(function (q, i) { if (S.picked[i] === q.ans) correct++; });
  S.done = true; S.submittedAt = Date.now(); S.correct = correct;
  S.score = Math.round(correct * 1000 / S.total) / 10;
  S.pass = S.mode === 'mock' ? S.score >= e.pass : null;
  store.del(KEY.ses);
  var his = store.get(KEY.his, []);
  his.unshift({ examId: S.examId, mode: S.mode, type: S.type || '', src: S.src || '', paper: S.paper || null, label: S.label || '',
    ts: Date.now(), score: S.score, correct: correct, total: S.total, pass: S.pass,
    usedSec: Math.round((S.submittedAt - S.startTs) / 1000),
    detail: S.qs.map(function (q, i) { return { id: q.id, p: q.perm || null, k: S.picked[i] }; }) });
  his = his.slice(0, HIS_MAX);
  his.forEach(function (r, i) { if (i >= HIS_DETAIL) delete r.detail; });
  store.set(KEY.his, his);
  // 錯題本：答錯／未答記入；答對標記為已解決
  var wr = getWrong(), wm = {};
  wr.forEach(function (x) { wm[x.id] = x; });
  S.qs.forEach(function (q, i) {
    var f = wm[q.id];
    if (S.picked[i] !== q.ans) { if (f) f.w = Date.now(); else { f = { id: q.id, exam: q.exam || S.examId, w: Date.now() }; wr.push(f); wm[q.id] = f; } }
    else if (f) f.r = Date.now();
  });
  if (wr.length > WRONG_MAX) wr = wr.filter(function (x) { return !x.r || x.w > x.r; }).slice(-Math.round(WRONG_MAX * 0.8));
  store.set(KEY.wrong, wr);
  scheduleSync();
  if (auto) openModal('時間到', '測驗時間已結束，系統已自動交卷。', '<button class="btn btn-pri" data-act="toResults">查看成績</button>');
  else vResults();
}

/* ================= 導覽（回上一頁） ================= */
var NAV = [], curView = 'home', curArgs = {};
function setView(v, a) { curView = v; curArgs = a || {}; renderAcct(); }
function pushNav() { NAV.push({ v: curView, a: curArgs }); if (NAV.length > 30) NAV.shift(); }
function navBack() {
  var p = NAV.pop();
  if (!p) return vHome();
  var a = p.a || {};
  switch (p.v) {
    case 'exam': return (S && !S.done) ? vExam() : vHome();
    case 'results': return (S && S.done) ? vResults() : vHome();
    case 'review': return (S && S.done) ? vReview() : vHome();
    case 'marks': return vMarks(a.f || '');
    case 'bank': return vBank(a.id, a.topic, a.page);
    case 'hisd': return vHisDetail(a.i, a.f);
    case 'intro': return vIntro(a.id);
    case 'custom': return vCustom(a.id);
    case 'papers': return vPapers(a.id, a.tab, a.sub);
    default: return vHome();
  }
}
function setHTML(h) { app.innerHTML = h; window.scrollTo(0, 0); updateFab(); renderAcct(); }
function backBar(title, extra) {
  return '<div class="pagebar"><button class="btn btn-ghost btn-sm" data-act="back">← 回上一頁</button><b>' + title + '</b><span class="sp"></span>'
    + (extra || '') + '<button class="btn btn-ghost btn-sm" data-act="home">回首頁</button></div>';
}

/* ================= 題目卡片（檢討／收藏／題庫瀏覽共用） ================= */
function offNote(item) {
  var y = (String(item.topic || '').match(/(\d{4})\s*年/) || [])[1], h;
  if (item.kind === 'book') {
    h = '<div class="offnote">📋 本題出自<b>' + esc(String(item.subject || '').split('｜')[0] || '書籍題庫') + '</b>，綠色標示為<b>標準答案</b>。</div>';
  } else {
    h = '<div class="offnote">📋 本題為<b>官方歷屆試題</b>' + (y ? '（' + y + ' 年）' : '') + '，綠色標示為<b>官方標準答案</b>。'
      + (y && +y < 2025 ? '<br><span class="ow">※ 早期年份試題若涉及已修正之法規數字，請以最新法規為準。</span>' : '') + '</div>';
  }
  if (item.note) h += '<div class="offexp"><b>解析</b>　' + fmtTxt(item.note) + '</div>';
  return h;
}
function hasOptExp(item) { return item.exps && item.exps.some(function (x) { return x; }); }
/* picked：使用者選項（null＝未作答，undefined＝不顯示作答） */
function optionRows(item, picked, showAns) {
  var h = '';
  for (var j = 0; j < 4; j++) {
    var cls = 'ropt';
    if (showAns) { if (j === item.ans) cls += ' ans'; else if (picked === j) cls += ' pickw'; }
    else if (picked === j) cls += ' sel';
    h += '<div class="' + cls + '"><span class="k">' + L(j) + '</span><div class="body">' + esc(item.opts[j])
      + (showAns && j === item.ans ? '<span class="tag t-ans">正確答案</span>' : '')
      + (picked === j && (!showAns || j !== item.ans) ? '<span class="tag ' + (showAns ? 't-you' : 't-pick') + '">你的答案</span>' : '')
      + (showAns && item.exps[j] ? '<span class="why">' + (j === item.ans ? '✓ ' : '✗ ') + fmtTxt(item.exps[j]) + '</span>' : '')
      + '</div></div>';
  }
  if (showAns && !hasOptExp(item)) h += offNote(item);
  else if (showAns && item.note) h += '<div class="offexp"><b>解析</b>　' + fmtTxt(item.note) + '</div>';
  if (showAns && item.src) h += '<div class="src">依據：' + fmtTxt(item.src) + '</div>';
  return h;
}
function markBtn(id, act, extra) {
  var on = isMarked(id);
  return '<button class="qmark' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' + esc(id) + '"' + (extra || '') + ' title="收藏複習：永久保存，右下角 ⭐ 可隨時回顧">' + (on ? '★ 已收藏' : '☆ 收藏') + '</button>';
}
function tags(item) {
  return (item.subject ? '<span class="qtag">' + esc(item.subject) + '</span>' : '') + '<span class="qtag">' + esc(item.topic) + '</span>';
}

/* ================= 首頁 ================= */
function isDemo() { return Object.keys(BANK).some(function (k) { return BANK[k].some(function (q) { return /^DEMO-/.test(q.id); }); }); }
function vHome() {
  clearInterval(timerId); timerId = null; S = null; sheetOpen = false; NAV = []; setView('home');
  if (!META) { setHTML('<div class="panel" style="text-align:center"><h2>題庫建置中</h2><p class="notice">資料尚未載入，請稍後重新整理。</p></div>'); return; }
  var saved = store.get(KEY.ses, null), his = store.get(KEY.his, []), h = '';
  h += '<header class="brand"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><rect x="2" y="2" width="40" height="40" rx="8" fill="#1D4F91"/><text x="22" y="30" text-anchor="middle" font-size="21" font-weight="700" fill="#fff">測</text></svg>'
    + '<div><h1>' + esc(META.title) + '</h1><div class="sub">信託業業務人員信託業務專業測驗 ─ 期貨商業務員資格測驗｜電腦應試模擬</div></div></header>';
  if (isDemo()) h += '<div class="demo-banner">🧪 目前為<b>示範題庫</b>（每科僅數題，用於展示功能），正式題庫匯入後此提示會自動消失。</div>';
  if (saved && saved.qs && saved.qs.length) {
    var se = examById(saved.examId);
    h += '<div class="resume"><p>偵測到未完成的<b>《' + esc(saved.label || (se ? se.short : saved.examId)) + '》' + (saved.mode === 'mock' ? '模擬考' : '練習') + '</b>（已作答 '
      + saved.picked.filter(function (p) { return p != null; }).length + '／' + saved.total + ' 題）</p><span class="sp"></span>'
      + '<button class="btn btn-pri btn-sm" data-act="resume">繼續作答</button><button class="btn btn-ghost btn-sm" data-act="abandon">放棄</button></div>';
  }
  var groups = {}, gOrder = [];
  META.exams.forEach(function (e) { if (!groups[e.group]) { groups[e.group] = []; gOrder.push(e.group); } groups[e.group].push(e); });
  gOrder.forEach(function (g) {
    h += '<div class="gtitle">' + esc(g) + '</div><div class="cards">';
    groups[g].forEach(function (e) {
      var bn = bankOf(e.id).length, last = null, best = null;
      his.forEach(function (r) { if (r.examId === e.id && r.mode === 'mock') { if (!last) last = r; if (!best || r.score > best.score) best = r; } });
      var hasArchive = papersOf(e.id).length || poolOf(e.id, 'book').length;
      var anyWrong = wrongActive(e.id).length || wrongFromHistory(e.id, 5).length;
      h += '<div class="ecard ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h3>' + esc(e.name) + '</h3>'
        + '<p class="admin">' + esc(e.admin) + '</p>'
        + '<div class="chips"><span class="chip">題數 <b class="num">' + e.qn + '</b> 題</span><span class="chip">時間 <b class="num">' + e.min + '</b> 分</span>'
        + '<span class="chip">及格 <b class="num">' + e.pass + '</b> 分</span><span class="chip">題庫 <b class="num">' + bn + '</b> 題</span></div>'
        + '<div class="chips"><span class="chip">' + esc(e.split) + '</span>' + (e.calc ? '<span class="chip">🧮 ' + esc(e.calc) + '</span>' : '') + '</div>'
        + (last ? '<div class="last num">上次模擬 ' + last.score + ' 分 ─ 最佳 ' + best.score + ' 分</div>' : '')
        + '<div class="acts"><button class="btn btn-pri" data-act="intro" data-id="' + e.id + '"' + (bn ? '' : ' disabled') + '>模擬考</button>'
        + '<button class="btn btn-ghost" data-act="custom" data-id="' + e.id + '"' + (bn ? '' : ' disabled') + '>自訂練習</button>'
        + '<button class="btn btn-ghost" data-act="bankOpen" data-id="' + e.id + '"' + (bn ? '' : ' disabled') + '>題庫瀏覽</button>'
        + (hasArchive ? '<button class="btn btn-ghost" data-act="papers" data-id="' + e.id + '">歷屆／書籍題庫 ▾</button>' : '')
        + '<button class="btn btn-ghost" data-act="wrongMenu" data-id="' + e.id + '"' + (anyWrong ? '' : ' disabled') + '>錯題重練 ▾</button>'
        + '</div></div>';
    });
    h += '</div>';
  });
  if (his.length) {
    h += '<div class="hist"><h3>最近測驗紀錄</h3><div class="tw"><table><tr><th>時間</th><th>測驗</th><th>模式</th><th>成績</th><th>結果</th><th></th></tr>';
    his.slice(0, 10).forEach(function (r, i) {
      var e = examById(r.examId), pp = r.paper ? paperById(r.paper) : null;
      h += '<tr class="num"><td>' + fmtDate(r.ts) + '</td><td>' + esc(r.label || (e ? e.short : r.examId)) + (pp ? ' <span class="hpaper">' + esc(pp.label) + '</span>' : '') + '</td>'
        + '<td>' + modeName(r) + '</td><td>' + r.score + ' 分（' + r.correct + '/' + r.total + '）</td>'
        + '<td>' + (r.pass == null ? '—' : (r.pass ? '<span class="pass-y">及格</span>' : '<span class="pass-n">未及格</span>')) + '</td>'
        + '<td>' + (r.detail ? '<button class="linkbtn" data-act="hisView" data-i="' + i + '">檢視題目</button>' : '') + '</td></tr>';
    });
    h += '</table></div><div style="margin-top:8px"><button class="btn btn-ghost btn-sm" data-act="clearHisAsk">清除紀錄</button></div></div>';
  }
  h += '<div class="backup"><h3>資料備份（跨裝置搬移）</h3><p>未登入時，紀錄只存在這台裝置的瀏覽器。登入 Google 即可自動雲端同步；也可以用備份檔手動搬移：</p>'
    + '<div class="bkacts"><button class="btn btn-ghost btn-sm" data-act="doExport">⬇ 匯出紀錄（下載備份檔）</button><button class="btn btn-ghost btn-sm" data-act="doImport">⬆ 匯入紀錄（讀取備份檔）</button></div></div>';
  h += '<footer class="foot"><div class="disc"><b>資料來源與聲明：</b>'
    + '<div>題庫分三類 ─ 1. 官方歷屆試題（附官方標準答案）；2. 書籍題庫（依原書章節分類）；3. 依官方測驗範圍自編之詳解練習題（含逐選項解析）。</div>'
    + '<div class="i">考試制度依主辦單位最新電腦應試簡章設定（資料更新：' + esc(META.updated) + '）。</div>'
    + '<div class="i">早期年份試題若涉及已修正法規，請以最新法規為準；實際規定以主辦單位公告為準。</div></div>';
  (META.sources || []).forEach(function (s) { h += '<p>─ <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></p>'; });
  h += '</footer>';
  setHTML(h);
}
function modeName(r) {
  if (r.mode === 'mock') {
    if (r.paper) return '歷屆考題';
    if (r.type === 'weighted') return '模擬考（書籍題庫）';
    return r.src ? '模擬考（' + srcName(r.src) + '）' : '模擬考';
  }
  return { marks: '收藏題練習', wrong: '錯題重練', chapter: '分章練習' }[r.type] || '練習';
}

/* ================= 考前說明 ================= */
var introSrc = 'all';
function vIntro(id) {
  var e = examById(id), off = poolOf(id, 'off'), book = poolOf(id, 'book');
  introSrc = 'all';
  var h = '<div class="panel ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h2>' + esc(e.name) + '</h2><p class="admin">' + esc(e.admin) + '</p>'
    + '<dl class="rules"><dt>測驗題數</dt><dd class="num">' + e.qn + ' 題（' + esc(e.split) + '）</dd>'
    + '<dt>測驗時間</dt><dd class="num">' + e.min + ' 分鐘（時間到自動交卷）</dd>'
    + '<dt>及格標準</dt><dd class="num">本系統參考線 ' + e.pass + ' 分；單科不得低於 ' + e.floor + ' 分（答錯不倒扣）</dd>'
    + '<dt>計算器</dt><dd>' + esc(e.calc) + '</dd>'
    + (e.scope ? '<dt>測驗範圍</dt><dd>' + esc(e.scope) + '</dd>' : '')
    + '<dt>備註</dt><dd>' + esc(e.passNote) + '</dd></dl>';
  if (off.length || book.length) {
    h += '<div class="flabel">題目來源</div><div class="seg" id="segSrc"><button class="on" data-act="setSrc" data-s="all">全部題庫</button>'
      + (off.length ? '<button data-act="setSrc" data-s="off">僅官方歷屆試題</button>' : '')
      + (book.length ? '<button data-act="setSrc" data-s="book">僅' + esc(e.bookName || '書籍題庫') + '</button>' : '') + '</div>'
      + '<p class="srcnote">' + (off.length ? '<b>官方歷屆試題</b>：共 ' + off.length + ' 題，附官方標準答案。' : '')
      + (book.length ? (off.length ? '<br>' : '') + '<b>' + esc(e.bookName || '書籍題庫') + '</b>：共 ' + book.length + ' 題，可於「歷屆／書籍題庫」依章節練習。' : '') + '</p>';
  }
  var bn = bankOf(id).length;
  if (bn < e.qn) h += '<p class="srcnote">⚠️ 目前題庫僅 ' + bn + ' 題，少於正式題數，本次模擬將以現有題目出題。</p>';
  h += '<ul class="notice"><li>每次自題庫<b>隨機抽題</b>並打散選項，題目組合皆不同。</li>'
    + '<li>點選選項作答，可隨時修改；可按「🚩 標記」註記待檢查，並用<b>答題卡</b>快速跳題。</li>'
    + '<li>鍵盤快捷鍵：1–4 或 A–D 選答、← → 換題、F 標記。</li>'
    + '<li>交卷後立即結算成績，並提供<b>錯題解析</b>與各主題答對率。</li>'
    + '<li>離開或重新整理頁面，進度會暫存於本機，可回首頁續考。</li></ul>'
    + '<div class="pactions"><button class="btn btn-pri btn-lg" data-act="startMock" data-id="' + e.id + '">開始作答</button><button class="btn btn-ghost btn-lg" data-act="home">返回</button></div></div>';
  setHTML(h); setView('intro', { id: id });
}

/* ================= 自訂練習 ================= */
var custom = null;
function vCustom(id) {
  var e = examById(id), pool = bankOf(id), bySub = {}, subs = [], seen = {}, cnt = {};
  pool.forEach(function (q) {
    var s = q.subject || '', key = s + '|' + q.topic;
    cnt[q.topic] = (cnt[q.topic] || 0) + 1;
    if (!(s in bySub)) { bySub[s] = []; subs.push(s); }
    if (!seen[key]) { seen[key] = 1; bySub[s].push(q.topic); }
  });
  custom = { id: id, n: 20, topics: [], ordered: false };
  var h = '<div class="panel ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h2>自訂練習｜' + esc(e.short) + '</h2>'
    + '<p class="admin">不計時 ─ 每題作答後立即顯示解析，適合分主題複習（題庫共 ' + pool.length + ' 題）</p>'
    + '<div class="flabel">練習題數</div><div class="seg" id="segN">'
    + [10, 20, 30, 50].map(function (n) { return '<button data-act="setN" data-n="' + n + '"' + (n === 20 ? ' class="on"' : '') + '>' + n + ' 題</button>'; }).join('')
    + '<button data-act="setN" data-n="0">全部範圍</button></div>'
    + '<div class="flabel">題目順序</div><div class="seg" id="segO"><button class="on" data-act="setOrd" data-o="0">隨機打散</button><button data-act="setOrd" data-o="1">照原本順序（含選項）</button></div>'
    + '<div class="flabel">練習範圍（不選＝全部主題）</div>';
  subs.forEach(function (s) {
    if (s) h += '<div class="subhead">' + esc(s) + '</div>';
    h += '<div class="tchips">' + bySub[s].map(function (t) { return '<button data-act="tgTopic" data-t="' + esc(t) + '">' + esc(t) + '（' + cnt[t] + '）</button>'; }).join('') + '</div>';
  });
  h += '<div class="pactions"><button class="btn btn-pri btn-lg" data-act="startCustom">開始練習</button><button class="btn btn-ghost btn-lg" data-act="home">返回</button></div></div>';
  setHTML(h); setView('custom', { id: id });
}

/* ================= 歷屆考題／書籍題庫 ================= */
function vPapers(id, tab, sub) {
  var e = examById(id), ps = papersOf(id), chaps = bookChapters(id), hasBook = chaps.length > 0;
  tab = tab || (hasBook ? 'book' : 'off');
  if (tab === 'book' && !hasBook) tab = 'off';
  sub = sub || '';
  var totBook = chaps.reduce(function (s, c) { return s + c.n; }, 0);
  var h = '<div class="panel ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h2>歷屆／書籍題庫 ─ ' + esc(e.short) + '</h2><div class="bankf">'
    + (hasBook ? '<button class="' + (tab === 'book' ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="book">📚 ' + esc(e.bookName || '書籍題庫') + '（' + totBook + '）</button>' : '')
    + '<button class="' + (tab === 'off' ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="off">📄 歷屆考題（' + ps.length + ' 份）</button></div>';
  if (tab === 'book') {
    var books = [], bn = {};
    chaps.forEach(function (c) { if (bn[c.subject] == null) { bn[c.subject] = 0; books.push(c.subject); } bn[c.subject] += c.n; });
    if (books.length > 1) {
      if (books.indexOf(sub) < 0) sub = '';
      h += '<div class="bankf sub"><button class="' + (sub ? '' : 'on') + '" data-act="pTab" data-id="' + id + '" data-tab="book" data-sub="">全部（' + totBook + '）</button>'
        + books.map(function (b) { return '<button class="' + (sub === b ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="book" data-sub="' + esc(b) + '">' + esc(bookLabel(b) || b) + '（' + bn[b] + '）</button>'; }).join('') + '</div>';
    }
    h += '<div class="plist"><button class="wrow wrow-hi" data-act="bookRand" data-id="' + id + '"><span>🎲 隨機抽題模擬<span class="rdesc">比照正式考試 ' + e.qn + ' 題／' + e.min + ' 分鐘'
      + (e.chw && e.chw.length ? '，依歷屆各章出題比例抽題' : '，依各章題數比例抽題') + '</span></span><b class="num">' + Math.min(e.qn, totBook) + ' 題</b></button></div>';
    var cur = null;
    h += '<div class="plist">';
    chaps.forEach(function (c) {
      if (sub && c.subject !== sub) return;
      if (books.length > 1 && !sub && c.subject !== cur) { cur = c.subject; h += '</div><div class="subhead">' + esc(bookLabel(cur) || cur) + '</div><div class="plist">'; }
      h += '<button class="wrow" data-act="bookChap" data-id="' + id + '" data-sub="' + esc(c.subject) + '" data-t="' + esc(c.topic) + '"><span>' + esc(c.topic) + '</span><b class="num">' + c.n + ' 題</b></button>';
    });
    h += '</div>';
  } else {
    var byY = {}, years = [];
    ps.forEach(function (p) { if (!byY[p.yROC]) { byY[p.yROC] = []; years.push(p.yROC); } byY[p.yROC].push(p); });
    years.sort(function (a, b) { return b - a; });
    if (sub && years.indexOf(+sub) < 0) sub = '';
    if (years.length) {
      h += '<div class="bankf sub"><button class="' + (sub ? '' : 'on') + '" data-act="pTab" data-id="' + id + '" data-tab="off" data-sub="">全部（' + ps.length + '）</button>'
        + years.map(function (y) { return '<button class="' + (+sub === y ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="off" data-sub="' + y + '">民國 ' + y + ' 年（' + byY[y].length + '）</button>'; }).join('') + '</div>';
    }
    years.forEach(function (y) {
      if (sub && +sub !== y) return;
      if (!sub) h += '<div class="subhead">民國 ' + y + ' 年（西元 ' + (y + 1911) + '）</div>';
      h += '<div class="plist">' + byY[y].map(function (p) {
        return '<button class="wrow" data-act="startPaper" data-paper="' + esc(p.id) + '"><span>' + esc(p.label) + (p.qn < e.qn ? ' <span class="ppartial">部分卷</span>' : '') + '</span><b class="num">' + p.qn + ' 題</b></button>';
      }).join('') + '</div>';
    });
    if (!ps.length) h += '<div class="mempty">目前尚無此科目的歷屆整份試卷。</div>';
  }
  h += '<div class="pactions"><button class="btn btn-ghost btn-lg" data-act="home">返回首頁</button></div></div>';
  setHTML(h); setView('papers', { id: id, tab: tab, sub: sub });
}

/* ================= 作答畫面 ================= */
function sessionTitle() {
  var e = examById(S.examId);
  return S.label || (e ? e.short : '');
}
function sessionMode() {
  if (S.mode === 'mock') {
    if (S.paper) return '歷屆考題';
    if (S.type === 'weighted') return '模擬考 ─ ' + ((examById(S.examId) || {}).bookName || '書籍題庫');
    return S.src && S.src !== 'all' ? '模擬考 ─ ' + srcName(S.src) : '模擬考';
  }
  return { marks: '收藏題練習', wrong: '錯題重練', chapter: '分章練習' }[S.type] || '練習模式';
}
function vExam() {
  var e = examById(S.examId), q = S.qs[S.idx], mock = S.mode === 'mock';
  var revealed = !mock && S.shown[S.idx];
  var h = '<div class="' + hueCls(e) + '"><div class="exam-top"><span class="ttl">' + esc(sessionTitle()) + '</span><span class="mode">' + esc(sessionMode()) + '</span>'
    + '<span class="mid">' + (mock ? '<span style="text-align:right"><span class="tmr-cap">剩餘時間</span><span class="tmr num" id="tmr">--:--</span></span>' : '<span class="prog">不計時</span>')
    + '<span class="prog num">已答 <b>' + answered() + '</b>／' + S.total + '</span>'
    + '<button class="btn btn-ghost btn-sm sheet-toggle" data-act="sheet">答題卡</button>'
    + '<button class="btn ' + (mock ? 'btn-danger' : 'btn-pri') + ' btn-sm" data-act="submitAsk">' + (mock ? '交卷' : '結束練習') + '</button></span></div>';
  h += '<div class="exam-wrap"><div><div class="qcard"><div class="qhead"><span class="qno num">第 ' + (S.idx + 1) + ' 題</span>' + tags(q)
    + '<span class="qbtns"><button class="qflag' + (S.flags[S.idx] ? ' on' : '') + '" data-act="flag" title="標記待檢查：交卷前可逐題複查（鍵盤 F）">' + (S.flags[S.idx] ? '🚩 已標記' : '🚩 標記') + '</button>'
    + markBtn(q.id, 'markCur') + '</span></div><p class="qtext">' + esc(q.q) + '</p><div class="opts">';
  for (var i = 0; i < 4; i++) {
    var cls = 'opt';
    if (revealed) { if (i === q.ans) cls += ' is-ans'; else if (S.picked[S.idx] === i) cls += ' is-wrong'; }
    else if (S.picked[S.idx] === i) cls += ' sel';
    h += '<button class="' + cls + '" data-act="pick" data-i="' + i + '"' + (revealed ? ' disabled' : '') + '><span class="k">' + L(i) + '</span><span>' + esc(q.opts[i]) + '</span></button>';
  }
  h += '</div>';
  if (revealed) {
    var hit = S.picked[S.idx] === q.ans;
    h += '<div class="fb"><div class="verdict ' + (hit ? 'ok' : 'bad') + '">' + (hit ? '答對了！' : '答錯了，正確答案是 ' + L(q.ans)) + '</div>'
      + '<div class="fbnav"><button class="btn btn-ghost btn-sm" data-act="retryQ">🔁 當題重新作答</button><span class="sp"></span>'
      + (S.idx === S.total - 1 ? '<button class="btn btn-pri btn-sm" data-act="submitAsk">結束並看結果 →</button>' : '<button class="btn btn-pri btn-sm" data-act="next">下一題 →</button>') + '</div>';
    if (hasOptExp(q)) {
      h += '<ul>' + q.exps.map(function (x, j) { return '<li class="' + (j === q.ans ? 'hit' : '') + '"><b>' + L(j) + (j === q.ans ? ' ✓' : ' ✗') + '</b><span>' + fmtTxt(x || '') + '</span></li>'; }).join('') + '</ul>';
      if (q.note) h += '<div class="offexp"><b>解析</b>　' + fmtTxt(q.note) + '</div>';
    } else h += offNote(q);
    if (q.src) h += '<div class="src">依據：' + fmtTxt(q.src) + '</div>';
    h += '</div>';
  }
  h += '<div class="qnav"><button class="btn btn-ghost" data-act="prev"' + (S.idx === 0 ? ' disabled' : '') + '>← 上一題</button><span class="sp"></span>'
    + '<button class="btn btn-ghost" data-act="next"' + (S.idx === S.total - 1 ? ' disabled' : '') + '>下一題 →</button></div></div></div>';
  h += '<aside class="sheet' + (sheetOpen ? ' open' : '') + '"><h4>答題卡</h4><div class="legend"><span class="l-done"><i></i>已作答</span><span><i></i>未作答</span><span class="l-flag"><i></i>標記</span></div><div class="gq-grid">';
  for (var k = 0; k < S.total; k++) {
    var c = 'gq num' + (S.picked[k] != null ? ' done' : '') + (S.flags[k] ? ' flag' : '') + (k === S.idx ? ' cur' : '');
    h += '<button class="' + c + '" data-act="jump" data-i="' + k + '">' + (k + 1) + '</button>';
  }
  h += '</div><div class="subact"><button class="btn ' + (mock ? 'btn-danger' : 'btn-pri') + ' btn-sm" style="flex:1" data-act="submitAsk">' + (mock ? '交卷' : '結束練習') + '</button>'
    + '<button class="btn btn-ghost btn-sm" data-act="retryAllAsk">整份重新作答</button><button class="btn btn-ghost btn-sm sheet-toggle" data-act="sheet">收合</button></div></aside></div></div>';
  setHTML(h); setView('exam');
  if (mock) startTimer();
}
function startTimer() {
  clearInterval(timerId);
  function tick() {
    if (!S || S.done) return clearInterval(timerId);
    var left = (S.deadline - Date.now()) / 1000, el = document.getElementById('tmr');
    if (el) { el.textContent = fmtClock(left); el.classList.toggle('low', left <= 300); }
    if (left <= 0) { clearInterval(timerId); submit(true); }
  }
  tick(); timerId = setInterval(tick, 500);
}

/* ================= 成績單 ================= */
function topicStats() {
  var m = {}, order = [];
  S.qs.forEach(function (q, i) {
    var t = (q.subject ? q.subject + '｜' : '') + q.topic;
    if (!m[t]) { m[t] = { c: 0, n: 0 }; order.push(t); }
    m[t].n++; if (S.picked[i] === q.ans) m[t].c++;
  });
  return order.map(function (t) { return { t: t, c: m[t].c, n: m[t].n }; });
}
function vResults() {
  sheetOpen = false;
  var e = examById(S.examId), mock = S.mode === 'mock', wrong = 0, skip = 0;
  S.qs.forEach(function (q, i) { if (S.picked[i] == null) skip++; else if (S.picked[i] !== q.ans) wrong++; });
  var used = Math.round(((S.submittedAt || Date.now()) - S.startTs) / 1000);
  var h = '<div class="' + hueCls(e) + '"><div class="result-hero"><div class="score-big"><span class="v num">' + S.score + '</span><span class="d">／100</span></div>'
    + (mock ? '<div><span class="stamp ' + (S.pass ? 'pass">及 格' : 'fail">未及格') + '</span></div>' : '')
    + '<div class="rmeta"><h2>' + esc(sessionTitle()) + '｜' + (mock ? '模擬考成績單' : '練習結果') + '</h2><div class="row">'
    + '<span class="chip">答對 <b class="num">' + S.correct + '</b>／' + S.total + ' 題</span><span class="chip">答錯 <b class="num">' + wrong + '</b> 題</span>'
    + '<span class="chip">未答 <b class="num">' + skip + '</b> 題</span><span class="chip">用時 <b class="num">' + fmtClock(used) + '</b></span>'
    + (mock ? '<span class="chip">參考及格 <b class="num">' + e.pass + '</b> 分</span>' : '')
    + (mock && S.score < e.floor ? '<span class="chip" style="color:var(--bad)">低於單科最低 <b class="num">' + e.floor + '</b> 分</span>' : '') + '</div>'
    + (mock ? '<p class="rnote">' + esc(e.passNote) + '</p>' : '') + '</div></div>';
  h += '<div class="tstats"><h3>各主題答對率</h3>';
  topicStats().forEach(function (r) {
    var p = Math.round(r.c * 100 / r.n), col = p >= 70 ? 'var(--ok-b)' : (p >= 50 ? '#D19A1F' : 'var(--bad-b)');
    h += '<div class="trow"><span class="lbl" title="' + esc(r.t) + '">' + esc(r.t) + '</span><span class="track"><span class="fill" style="width:' + p + '%;background:' + col + '"></span></span><span class="pct num">' + r.c + '/' + r.n + '（' + p + '%）</span></div>';
  });
  h += '</div><div class="racts"><button class="btn btn-pri btn-lg" data-act="review" data-f="wrong">錯題檢討（' + (wrong + skip) + '）</button>'
    + '<button class="btn btn-ghost btn-lg" data-act="review" data-f="all">全部題目檢討</button>'
    + '<button class="btn btn-ghost btn-lg" data-act="retryAllAsk">整份重新作答（同題）</button>'
    + '<button class="btn btn-ghost btn-lg" data-act="again">再測一次（重新抽題）</button>'
    + '<button class="btn btn-ghost btn-lg" data-act="home">回首頁</button></div></div>';
  setHTML(h); setView('results');
}

/* ================= 檢討 ================= */
function reviewCard(item, no, picked, markAttr) {
  var ok = picked === item.ans;
  return '<div class="rcard ' + (ok ? 'correct-card' : 'wrong-card') + '"><div class="rhead"><span class="qno num" style="font-size:15px">第 ' + no + ' 題</span>'
    + '<span class="st ' + (picked == null ? 'skip">未作答' : (ok ? 'ok">答對' : 'bad">答錯')) + '</span>' + tags(item)
    + (markAttr ? '<span class="qbtns">' + markBtn(item.id, 'markId') + '</span>' : '') + '</div>'
    + '<p class="ovq">' + esc(item.q) + '</p>' + optionRows(item, picked, true) + '</div>';
}
function vReview() {
  var e = examById(S.examId), h = '<div class="' + hueCls(e) + '"><div class="rev-top"><button class="btn btn-ghost btn-sm" data-act="toResults">← 回成績單</button>'
    + '<b style="font-size:14px">' + esc(sessionTitle()) + '｜題目檢討</b><span class="sp"></span>'
    + '<div class="tabs"><button class="' + (reviewFilter === 'wrong' ? 'on' : '') + '" data-act="rf" data-f="wrong">只看錯題</button><button class="' + (reviewFilter === 'all' ? 'on' : '') + '" data-act="rf" data-f="all">全部題目</button></div></div>';
  var n = 0;
  S.qs.forEach(function (q, i) {
    if (reviewFilter === 'all' || S.picked[i] !== q.ans) { n++; h += reviewCard(q, i + 1, S.picked[i], true); }
  });
  if (!n) h += '<div class="panel" style="text-align:center"><h2>全數答對！</h2><p class="notice">本次作答沒有錯題，繼續保持。</p></div>';
  h += '<div class="racts"><button class="btn btn-pri" data-act="toResults">← 回成績單</button><button class="btn btn-ghost" data-act="again">再測一次</button><button class="btn btn-ghost" data-act="home">回首頁</button></div></div>';
  setHTML(h); setView('review');
}

/* ================= 作答紀錄詳情 ================= */
function vHisDetail(i, f) {
  var r = store.get(KEY.his, [])[i];
  if (!r || !r.detail) return vHome();
  f = f || 'wrong';
  var e = examById(r.examId), list = [], missing = 0;
  r.detail.forEach(function (d, di) {
    var raw = rawById(d.id);
    if (!raw) { missing++; return; }
    var p = (d.p && d.p.length === 4) ? d.p : [0, 1, 2, 3], it = toItem(raw, true);
    it.opts = p.map(function (x) { return raw.options[x]; });
    it.exps = p.map(function (x) { return (raw.explain && raw.explain[x]) || ''; });
    it.ans = p.indexOf(raw.answer);
    list.push({ no: di + 1, item: it, picked: d.k == null ? null : d.k });
  });
  var wrongN = list.filter(function (x) { return x.picked !== x.item.ans; }).length;
  var shown = f === 'all' ? list : list.filter(function (x) { return x.picked !== x.item.ans; });
  var h = '<div class="' + hueCls(e) + '">' + backBar(fmtDate(r.ts) + '　' + esc(r.label || (e ? e.short : r.examId)) + ' ─ 作答檢視　<span class="num">' + r.score + ' 分</span>',
    '<div class="tabs"><button class="' + (f === 'wrong' ? 'on' : '') + '" data-act="hisF" data-f="wrong">只看錯題（' + wrongN + '）</button><button class="' + (f === 'all' ? 'on' : '') + '" data-act="hisF" data-f="all">全部（' + list.length + '）</button></div>');
  if (missing) h += '<div class="mhint">※ 題庫其後有更新，本紀錄中 ' + missing + ' 題已無法對應顯示。</div>';
  if (!shown.length) h += '<div class="mempty">' + (f === 'wrong' ? '本次全數答對，沒有錯題。' : '沒有題目。') + '</div>';
  shown.forEach(function (x) { h += reviewCard(x.item, x.no, x.picked, true); });
  setHTML(h + '</div>'); setView('hisd', { i: i, f: f });
}

/* ================= 題庫瀏覽 ================= */
function vBank(id, topic, page) {
  var e = examById(id), all = bankOf(id), cnt = {}, groups = {}, gOrder = [];
  all.forEach(function (q) {
    cnt[q.topic] = (cnt[q.topic] || 0) + 1;
    var s = q.subject || '';
    if (!(s in groups)) { groups[s] = []; gOrder.push(s); }
    if (groups[s].indexOf(q.topic) < 0) groups[s].push(q.topic);
  });
  var pool = topic ? all.filter(function (q) { return q.topic === topic; }) : all;
  var pages = Math.max(1, Math.ceil(pool.length / BANK_PG));
  page = Math.min(Math.max(0, page || 0), pages - 1);
  var h = '<div class="' + hueCls(e) + '">' + backBar(esc(e.short) + ' ─ 題庫瀏覽（' + pool.length + ' 題）');
  h += '<div class="bankf"><label class="bfl" for="bankSel">主題篩選</label><select id="bankSel" class="bsel"><option value="">全部主題（' + all.length + ' 題）</option>';
  gOrder.forEach(function (s) {
    var o = groups[s].map(function (t) { return '<option value="' + esc(t) + '"' + (topic === t ? ' selected' : '') + '>' + esc(t) + '（' + cnt[t] + ' 題）</option>'; }).join('');
    h += s ? '<optgroup label="' + esc(s) + '">' + o + '</optgroup>' : o;
  });
  h += '</select></div>';
  var pgn = '<div class="pgn"><button class="btn btn-ghost btn-sm" data-act="bankPg" data-p="' + (page - 1) + '"' + (page <= 0 ? ' disabled' : '') + '>← 上一頁</button>'
    + '<span class="pginfo num">第 ' + (page + 1) + ' ／ ' + pages + ' 頁</span><button class="btn btn-ghost btn-sm" data-act="bankPg" data-p="' + (page + 1) + '"' + (page >= pages - 1 ? ' disabled' : '') + '>下一頁 →</button></div>';
  h += pgn;
  pool.slice(page * BANK_PG, (page + 1) * BANK_PG).forEach(function (q, i) {
    var it = viewOf(q);
    h += '<div class="ovcard"><div class="ovhead"><span class="mbadge num">#' + (page * BANK_PG + i + 1) + '</span>' + tags(it) + '<span class="sp"></span>' + markBtn(q.id, 'markId') + '</div>'
      + '<p class="ovq">' + esc(q.q) + '</p>' + optionRows(it, undefined, true) + '</div>';
  });
  setHTML(h + pgn + '</div>'); setView('bank', { id: id, topic: topic || '', page: page });
}

/* ================= 收藏頁 ================= */
function markMatch(m, f) {
  if (!f) return true;
  if (f.indexOf('g:') === 0) { var e = examById(m.exam); return !!e && e.group === f.slice(2); }
  return m.exam === f;
}
function vMarks(f) {
  f = f || '';
  var marks = getMarks(), cnt = {};
  marks.forEach(function (m) { cnt[m.exam] = (cnt[m.exam] || 0) + 1; });
  var order = META.exams.map(function (e) { return e.id; }).filter(function (id) { return cnt[id]; });
  Object.keys(cnt).forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
  var h = backBar('⭐ 收藏（複習）　<span class="num" id="mkCnt">' + marks.length + '</span> 題');
  if (!marks.length) {
    setHTML(h + '<div class="mempty">還沒有收藏任何題目。<br>作答、檢討或題庫瀏覽時，按題目右上角的「☆ 收藏」，題目就會存進這裡供之後複習。</div>');
    setView('marks', { f: '' }); return;
  }
  var grp = {}, gOrd = [];
  order.forEach(function (id) { var e = examById(id); if (e) { if (!grp[e.group]) { grp[e.group] = []; gOrd.push(e.group); } grp[e.group].push(id); } });
  gOrd = gOrd.filter(function (g) { return grp[g].length > 1; });
  if (f && f.indexOf('g:') !== 0 && !cnt[f]) f = '';
  if (f.indexOf('g:') === 0 && gOrd.indexOf(f.slice(2)) < 0) f = '';
  h += '<div class="bankf"><button class="' + (f ? '' : 'on') + '" data-act="mkF" data-f="">全部（' + marks.length + '）</button>'
    + gOrd.map(function (g) { var n = grp[g].reduce(function (s, id) { return s + cnt[id]; }, 0); return '<button class="' + (f === 'g:' + g ? 'on' : '') + '" data-act="mkF" data-f="' + esc('g:' + g) + '">' + esc(g) + ' 全科（' + n + '）</button>'; }).join('')
    + order.map(function (id) { var e = examById(id); return '<button class="' + (f === id ? 'on' : '') + '" data-act="mkF" data-f="' + esc(id) + '">' + esc(e ? e.short : id) + '（' + cnt[id] + '）</button>'; }).join('') + '</div>';
  var shown = marks.filter(function (m) { return markMatch(m, f); });
  h += '<div class="mkact"><button class="btn btn-pri" data-act="mkPractice" data-f="' + esc(f) + '">▶ 練習這 ' + shown.length + ' 題（隨機出題）</button><span class="mkhint">練習時作答後立即顯示解析。</span></div>'
    + '<div class="mhint">直接往下滑逐題複習（含正確答案與解析）。</div>';
  var ids = (f && f.indexOf('g:') !== 0) ? [f] : (f ? grp[f.slice(2)] : order);
  ids.forEach(function (id) {
    var e = examById(id);
    if (ids.length > 1 || !f) h += '<div class="gtitle">' + esc(e ? e.short : id) + '（' + cnt[id] + ' 題）</div>';
    marks.forEach(function (m) {
      if (m.exam !== id) return;
      var it = viewOf(markRaw(m));
      h += '<div class="ovcard ' + hueCls(e) + '"><div class="ovhead"><span class="mbadge">' + esc(e ? e.short : m.exam) + '</span>' + tags(it)
        + '<span class="sp"></span><button class="ovx" data-act="unmark" data-id="' + esc(m.id) + '">★ 取消收藏</button></div>'
        + '<p class="ovq">' + esc(it.q) + '</p>' + optionRows(it, undefined, true) + '</div>';
    });
  });
  setHTML(h); setView('marks', { f: f });
}

/* ================= 標記覆蓋層／浮動按鈕 ================= */
function buildChrome() {
  var fabs = document.createElement('div'); fabs.id = 'fabs';
  fabs.innerHTML = '<button class="fab fab-flag" data-act="openFlags" title="標記（待檢查）">🚩<span id="fabF" class="fabn"></span></button>'
    + '<button class="fab fab-mark" data-act="openMarks" title="收藏（複習）">⭐<span id="fabM" class="fabn"></span></button>';
  document.body.appendChild(fabs);
  var acct = document.createElement('div'); acct.id = 'acct'; acct.hidden = true; document.body.appendChild(acct);
  var ov = document.createElement('div'); ov.id = 'movl'; ov.className = 'movl'; ov.hidden = true;
  ov.innerHTML = '<div class="movl-box"><div class="movl-head"><b id="movlTitle"></b><span class="sp"></span><button class="btn btn-ghost btn-sm" data-act="closeFlags">關閉 ✕</button></div><div id="movlBody"></div></div>';
  document.body.appendChild(ov);
  var inp = document.createElement('input'); inp.type = 'file'; inp.id = 'impf'; inp.accept = 'application/json,.json'; inp.style.display = 'none';
  inp.addEventListener('change', function (ev) { importData(ev.target.files[0]); ev.target.value = ''; });
  document.body.appendChild(inp);
}
function curFlags() { var a = []; if (S && S.qs) S.qs.forEach(function (q, i) { if (S.flags[i]) a.push(i); }); return a; }
function updateFab() {
  var nm = getMarks().length, nf = curFlags().length, m = document.getElementById('fabM'), f = document.getElementById('fabF');
  if (m) { m.textContent = nm || ''; m.parentNode.classList.toggle('has', nm > 0); }
  if (f) { f.textContent = nf || ''; f.parentNode.classList.toggle('has', nf > 0); }
}
function openFlags() {
  var fl = curFlags(), body = document.getElementById('movlBody'), h;
  document.getElementById('movlTitle').textContent = '🚩 標記（待檢查）' + (fl.length ? '　' + fl.length + ' 題' : '');
  if (!fl.length) h = '<div class="mempty">目前沒有標記待檢查的題目。<br>作答時按題目右上角的「🚩 標記」（或鍵盤 F），題目就會列在這裡，方便<b>交卷前逐題複查</b>。</div>';
  else {
    var showAns = S.mode !== 'mock' || S.done;
    h = '<div class="mhint">本次共標記 ' + fl.length + ' 題' + (showAns ? '' : '（測驗進行中，暫不顯示正確答案）') + '，可按「跳到此題」回去作答。</div>';
    fl.forEach(function (i) {
      var q = S.qs[i];
      h += '<div class="ovcard"><div class="ovhead"><span class="mbadge">第 ' + (i + 1) + ' 題</span>' + tags(q) + '<span class="sp"></span>'
        + (S.done ? '' : '<button class="ovgo" data-act="flagJump" data-i="' + i + '">跳到此題 →</button>') + '</div>'
        + '<p class="ovq">' + esc(q.q) + '</p>' + optionRows(q, S.picked[i], showAns && (S.mode !== 'practice' || S.shown[i] || S.done)) + '</div>';
    });
  }
  body.innerHTML = h; body.scrollTop = 0;
  document.getElementById('movl').hidden = false;
}

/* ================= Modal ================= */
function openModal(title, body, acts) {
  closeModal();
  var d = document.createElement('div'); d.className = 'mask'; d.id = 'mask';
  d.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><div>' + body + '</div><div class="macts">' + acts + '</div></div>';
  document.body.appendChild(d);
}
function closeModal() { var m = document.getElementById('mask'); if (m) m.remove(); }

/* ================= 匯出／匯入 ================= */
function exportData() {
  var data = { app: 'tfe', v: 1, ts: Date.now(), history: store.get(KEY.his, []), marks: getMarks(), wrong: getWrong() };
  try {
    var url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    var a = document.createElement('a'); a.href = url; a.download = '信託期貨證照練習紀錄備份.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  } catch (e) {}
  openModal('已匯出備份', '<p>已下載備份檔 <b>信託期貨證照練習紀錄備份.json</b>（含測驗紀錄、收藏題與錯題本）。<br><br>換裝置：把檔案傳到另一台裝置 → 開啟本網站 → 首頁按「匯入紀錄」選這個檔案。</p>',
    '<button class="btn btn-pri" data-act="modalClose">好</button>');
}
function importData(file) {
  if (!file) return;
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var d = JSON.parse(rd.result);
      if (!d || d.app !== 'tfe') throw 0;
      var his = mergeBy('ts', store.get(KEY.his, []), d.history); his.sort(function (a, b) { return b.ts - a.ts; });
      store.set(KEY.his, his.slice(0, HIS_MAX));
      store.set(KEY.marks, mergeBy('id', getMarks(), d.marks));
      mergeWrong(d.wrong); updateFab(); scheduleSync();
      openModal('匯入完成', '<p>已合併還原你的<b>測驗紀錄</b>、<b>收藏題</b>與<b>錯題本</b>。</p>', '<button class="btn btn-pri" data-act="home">好</button>');
    } catch (e) {
      openModal('匯入失敗', '<p>檔案格式不正確，請選擇由本系統「匯出紀錄」產生的 .json 檔。</p>', '<button class="btn btn-ghost" data-act="modalClose">關閉</button>');
    }
  };
  rd.readAsText(file);
}

/* ================= Google 登入＋雲端同步（Firebase，未設定則自動略過） ================= */
var fb = { auth: null, db: null, user: null, ready: false, t: null };
function loadFirebase(cb) {
  if (window.firebase && window.firebase.auth) return cb();
  var v = '10.12.2', files = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'], i = 0;
  (function next() {
    if (i >= files.length) return cb();
    var s = document.createElement('script'); s.src = 'https://www.gstatic.com/firebasejs/' + v + '/' + files[i++];
    s.onload = next; s.onerror = function () { cb(new Error('firebase')); };
    document.head.appendChild(s);
  })();
}
function initFirebase() {
  if (!FB_CONFIG || !FB_CONFIG.apiKey) return;
  loadFirebase(function (err) {
    if (err || !window.firebase) return;
    try {
      firebase.initializeApp(FB_CONFIG);
      fb.auth = firebase.auth(); fb.db = firebase.firestore(); fb.ready = true;
      fb.auth.onAuthStateChanged(function (u) { fb.user = u; if (u) cloudPull(); else renderAcct(); });
      renderAcct();
    } catch (e) {}
  });
}
var GOOGLE_G = '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
function renderAcct() {
  var a = document.getElementById('acct'); if (!a) return;
  // 作答／檢討／成績頁不顯示，避免蓋住內容
  if (!fb.ready || curView !== 'home') { a.hidden = true; a.innerHTML = ''; return; }
  a.hidden = false;
  if (fb.user) {
    var u = fb.user, name = u.displayName || u.email || '帳號';
    var av = u.photoURL ? '<img src="' + esc(u.photoURL) + '" referrerpolicy="no-referrer" alt="">' : esc(name.charAt(0).toUpperCase());
    a.innerHTML = '<button class="ava" data-act="acctMenu" title="' + esc(name) + '">' + av + '</button><div class="acctpop" id="acctpop" hidden><div class="ap-name">' + esc(name) + '</div>'
      + (u.email && u.email !== name ? '<div class="ap-mail">' + esc(u.email) + '</div>' : '') + '<div class="ap-sync">☁️ 雲端同步中</div><button class="btn btn-ghost btn-sm" data-act="logout">登出</button></div>';
  } else a.innerHTML = '<button class="gsi" data-act="login">' + GOOGLE_G + '<span>Google 登入同步</span></button>';
}
function scheduleSync() {
  if (!fb.ready || !fb.user) return;
  clearTimeout(fb.t);
  fb.t = setTimeout(function () {
    fb.db.collection('users').doc(fb.user.uid).set({ history: store.get(KEY.his, []), marks: getMarks(), wrong: getWrong(), updatedAt: Date.now() }).catch(function () {});
  }, 1500);
}
function cloudPull() {
  fb.db.collection('users').doc(fb.user.uid).get().then(function (doc) {
    var c = doc.exists ? doc.data() : {};
    var his = mergeBy('ts', store.get(KEY.his, []), c.history); his.sort(function (a, b) { return b.ts - a.ts; });
    store.set(KEY.his, his.slice(0, HIS_MAX));
    store.set(KEY.marks, mergeBy('id', getMarks(), c.marks));
    mergeWrong(c.wrong); updateFab(); scheduleSync();
    if (curView === 'home') vHome(); else renderAcct();
  }).catch(function () { renderAcct(); });
}

/* ================= 動作 ================= */
function seg(sel, t) { document.querySelectorAll(sel + ' button').forEach(function (b) { b.classList.toggle('on', b === t); }); }
var ACT = {
  home: function () { closeModal(); vHome(); },
  back: function () { navBack(); },
  intro: function (d) { vIntro(d.id); },
  custom: function (d) { vCustom(d.id); },
  papers: function (d) { pushNav(); vPapers(d.id); },
  pTab: function (d) { vPapers(d.id, d.tab, d.sub || ''); },
  bankOpen: function (d) { pushNav(); vBank(d.id, '', 0); },
  bankPg: function (d) { vBank(curArgs.id, curArgs.topic, +d.p); },
  hisView: function (d) { pushNav(); vHisDetail(+d.i, 'wrong'); },
  hisF: function (d) { vHisDetail(curArgs.i, d.f); },
  openMarks: function () { if (curView !== 'marks') pushNav(); vMarks(''); },
  mkF: function (d) { vMarks(d.f || ''); },

  setSrc: function (d, t) { introSrc = d.s; seg('#segSrc', t); },
  startMock: function (d) {
    var e = examById(d.id), pool = dedup(poolOf(d.id, introSrc));
    if (!pool.length) return;
    makeSession(d.id, 'mock', drawQuestions(e, Math.min(e.qn, pool.length), { src: introSrc }), { src: introSrc === 'all' ? '' : introSrc });
  },
  setN: function (d, t) { custom.n = +d.n; seg('#segN', t); },
  setOrd: function (d, t) { custom.ordered = d.o === '1'; seg('#segO', t); },
  tgTopic: function (d, t) {
    t.classList.toggle('on');
    var i = custom.topics.indexOf(d.t);
    if (i >= 0) custom.topics.splice(i, 1); else custom.topics.push(d.t);
  },
  startCustom: function () {
    var e = examById(custom.id), pool = bankOf(custom.id);
    if (custom.topics.length) pool = pool.filter(function (q) { return custom.topics.indexOf(q.topic) >= 0; });
    pool = dedup(pool);
    var n = custom.n === 0 ? pool.length : Math.min(custom.n, pool.length);
    if (!n) return;
    makeSession(custom.id, 'practice', drawQuestions(e, n, { topics: custom.topics.length ? custom.topics.slice() : null, ordered: custom.ordered }), {});
  },
  startPaper: function (d) {
    var p = paperById(d.paper); if (!p) return;
    var qs = p.questions.map(function (q, i) { return toItem(paperRaw(p, q, i), true); });
    makeSession(p.exam, 'mock', qs, { paper: p.id, label: p.examName + '｜' + p.label });
  },
  bookRand: function (d) {
    var e = examById(d.id), qs = drawWeighted(d.id, e.qn);
    if (qs.length) makeSession(d.id, 'mock', qs, { type: 'weighted', src: 'book' });
  },
  bookChap: function (d) {
    var list = poolOf(d.id, 'book').filter(function (q) { return q.topic === d.t && (q.subject || '') === (d.sub || ''); });
    if (list.length) makeSession(d.id, 'practice', shuffle(list).map(function (q) { return toItem(q); }), { type: 'chapter', label: d.t });
  },
  wrongMenu: function (d) {
    var id = d.id, e = examById(id);
    function row(lbl, n, s) { return '<button class="wrow" data-act="wrongStart" data-id="' + id + '" data-s="' + s + '"' + (n ? '' : ' disabled') + '><span>' + lbl + '</span><b class="num">' + n + ' 題</b></button>'; }
    openModal('錯題重練 ─ ' + (e ? e.short : id), '<div class="plist">'
      + row('最近一次作答的錯題', wrongFromHistory(id, 1).length, '1')
      + row('近三次作答錯題匯總', wrongFromHistory(id, 3).length, '3')
      + row('近五次作答錯題匯總', wrongFromHistory(id, 5).length, '5')
      + row('全部累積錯題（答對即自動移除）', wrongActive(id).length, 'all') + '</div>',
      '<button class="btn btn-ghost" data-act="modalClose">取消</button>');
  },
  wrongStart: function (d) {
    closeModal();
    var list = d.s === 'all' ? wrongActive(d.id).map(function (x) { return rawById(x.id); }).filter(Boolean) : wrongFromHistory(d.id, +d.s);
    if (list.length) makeSession(d.id, 'practice', shuffle(list).map(function (q) { return toItem(q); }), { type: 'wrong', wrongScope: d.s });
  },
  mkPractice: function (d) {
    var f = d.f || '', list = getMarks().filter(function (m) { return markMatch(m, f); });
    if (!list.length) return;
    var scope = '全部';
    if (f.indexOf('g:') === 0) scope = f.slice(2) + ' 全科';
    else if (f) { var e0 = examById(f); scope = e0 ? e0.short : f; }
    var qs = shuffle(list).map(function (m) { return toItem(markRaw(m)); });
    makeSession(qs[0].exam || META.exams[0].id, 'practice', qs, { type: 'marks', marksFil: f, label: '⭐ 收藏題｜' + scope });
  },

  pick: function (d) {
    var i = +d.i;
    if (S.mode === 'practice') { if (S.shown[S.idx]) return; S.picked[S.idx] = i; S.shown[S.idx] = true; }
    else S.picked[S.idx] = S.picked[S.idx] === i ? null : i;
    saveSession(); vExam();
  },
  prev: function () { if (S.idx > 0) { S.idx--; saveSession(); vExam(); } },
  next: function () { if (S.idx < S.total - 1) { S.idx++; saveSession(); vExam(); } },
  jump: function (d) { S.idx = +d.i; sheetOpen = false; saveSession(); vExam(); },
  flag: function () { S.flags[S.idx] = !S.flags[S.idx]; saveSession(); vExam(); },
  sheet: function () { sheetOpen = !sheetOpen; vExam(); },
  retryQ: function () { if (S.mode === 'practice') { S.picked[S.idx] = null; S.shown[S.idx] = false; saveSession(); vExam(); } },
  retryAllAsk: function () {
    openModal('整份重新作答？', '<p>將清空這份試卷的所有作答' + (S.mode === 'mock' ? '並重新計時' : '') + '，題目維持同一份。</p>',
      '<button class="btn btn-ghost" data-act="modalClose">取消</button><button class="btn btn-pri" data-act="retryAll">重新作答</button>');
  },
  retryAll: function () {
    closeModal();
    S.picked = fill(S.total, null); S.flags = fill(S.total, false); S.shown = fill(S.total, false);
    S.idx = 0; S.done = false; S.startTs = Date.now();
    if (S.mode === 'mock') S.deadline = Date.now() + S.limitMin * 60000;
    delete S.score; delete S.correct; delete S.pass; delete S.submittedAt;
    saveSession(); vExam();
  },
  submitAsk: function () {
    var un = S.total - answered(), fl = curFlags().length, mock = S.mode === 'mock';
    openModal(mock ? '確定要交卷嗎？' : '結束練習？',
      '<p>' + (mock ? '交卷後立即結算成績，不可再修改作答。' : '結束後將顯示本次結果。') + '<br>尚有 <b class="num">' + un + '</b> 題未作答' + (fl ? '、<b class="num">' + fl + '</b> 題標記待檢查' : '') + '。</p>',
      '<button class="btn btn-ghost" data-act="modalClose">繼續作答</button><button class="btn ' + (mock ? 'btn-danger' : 'btn-pri') + '" data-act="submitYes">' + (mock ? '確定交卷' : '結束並看結果') + '</button>');
  },
  submitYes: function () { closeModal(); submit(false); },
  toResults: function () { closeModal(); vResults(); },
  review: function (d) { reviewFilter = d.f; vReview(); },
  rf: function (d) { reviewFilter = d.f; vReview(); },
  again: function () {
    var e = examById(S.examId);
    if (S.paper) return ACT.startPaper({ paper: S.paper });
    if (S.type === 'marks') return ACT.mkPractice({ f: S.marksFil || '' });
    if (S.type === 'weighted') return ACT.bookRand({ id: S.examId });
    if (S.type === 'wrong') return ACT.wrongStart({ id: S.examId, s: S.wrongScope || 'all' });
    if (S.type === 'chapter') { var q0 = S.qs[0]; return ACT.bookChap({ id: S.examId, t: q0.topic, sub: q0.subject }); }
    if (S.mode === 'mock') { introSrc = S.src || 'all'; return ACT.startMock({ id: S.examId }); }
    var pool = dedup(bankOf(S.examId));
    makeSession(S.examId, 'practice', drawQuestions(e, Math.min(S.total, pool.length), {}), {});
  },
  resume: function () {
    var sv = store.get(KEY.ses, null); if (!sv) return vHome();
    S = sv;
    if (S.mode === 'mock' && Date.now() >= S.deadline) submit(true); else vExam();
  },
  abandon: function () { store.del(KEY.ses); vHome(); },
  clearHisAsk: function () {
    openModal('清除測驗紀錄？', '<p>將刪除所有測驗紀錄（收藏題與錯題本不受影響）' + (fb.user ? '，雲端同步資料也會一併更新' : '') + '。此動作無法復原。</p>',
      '<button class="btn btn-ghost" data-act="modalClose">取消</button><button class="btn btn-danger" data-act="clearHis">清除</button>');
  },
  clearHis: function () { closeModal(); store.del(KEY.his); scheduleSync(); vHome(); },

  markCur: function (d, t) { var on = toggleMark(S.qs[S.idx]); t.classList.toggle('on', on); t.textContent = on ? '★ 已收藏' : '☆ 收藏'; },
  markId: function (d, t) {
    var it = (S && S.qs && S.qs.filter(function (q) { return q.id === d.id; })[0]) || (rawById(d.id) && viewOf(rawById(d.id)));
    if (!it) return;
    var on = toggleMark(it);
    document.querySelectorAll('[data-act="markId"]').forEach(function (b) { if (b.dataset.id === d.id) { b.classList.toggle('on', on); b.textContent = on ? '★ 已收藏' : '☆ 收藏'; } });
  },
  unmark: function (d, t) {
    store.set(KEY.marks, getMarks().filter(function (m) { return m.id !== d.id; })); updateFab(); scheduleSync();
    if (!getMarks().length) return vMarks('');
    var card = t.closest('.ovcard'); if (card) card.remove();
    var c = document.getElementById('mkCnt'); if (c) c.textContent = getMarks().length;
  },
  openFlags: function () { openFlags(); },
  closeFlags: function () { document.getElementById('movl').hidden = true; },
  flagJump: function (d) { document.getElementById('movl').hidden = true; S.idx = +d.i; sheetOpen = false; saveSession(); vExam(); },

  modalClose: function () { closeModal(); },
  doExport: function () { exportData(); },
  doImport: function () { document.getElementById('impf').click(); },
  login: function () {
    if (!fb.auth) return;
    fb.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(function (e) {
      var code = (e && e.code) || '';
      if (/popup-closed|cancelled-popup|user-cancelled/.test(code)) return;
      openModal('登入失敗', '<p>' + esc((e && e.message) || '請再試一次，或確認瀏覽器未封鎖彈出視窗。') + '</p>', '<button class="btn btn-ghost" data-act="modalClose">關閉</button>');
    });
  },
  logout: function () { if (fb.auth) fb.auth.signOut(); },
  acctMenu: function () { var p = document.getElementById('acctpop'); if (p) p.hidden = !p.hidden; }
};

document.addEventListener('click', function (e) {
  var pop = document.getElementById('acctpop');
  if (pop && !pop.hidden && !e.target.closest('#acct')) pop.hidden = true;
  var t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  var fn = ACT[t.dataset.act];
  if (fn) fn(t.dataset, t, e);
});
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'bankSel' && curView === 'bank') vBank(curArgs.id, e.target.value || '', 0);
});
document.addEventListener('keydown', function (e) {
  if (!S || S.done || curView !== 'exam' || document.getElementById('mask') || !document.getElementById('movl').hidden) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  var k = e.key;
  if (k >= '1' && k <= '4') ACT.pick({ i: String(+k - 1) });
  else if (/^[a-dA-D]$/.test(k)) ACT.pick({ i: String('abcd'.indexOf(k.toLowerCase())) });
  else if (k === 'ArrowLeft') ACT.prev();
  else if (k === 'ArrowRight') ACT.next();
  else if (k === 'f' || k === 'F') ACT.flag();
});

buildChrome();
vHome();
initFirebase();
})();
