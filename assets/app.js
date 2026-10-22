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

var KEY = { ses: 'tfe.session.v1', his: 'tfe.history.v1', wrong: 'tfe.wrong.v1', marks: 'tfe.marks.v1', seen: 'tfe.seen.v1', papers: 'tfe.papers.v1' };
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
/* 「法規重點 01 信託概論與分類」→ { no: '01', name: '信託概論與分類' } */
function tShort(t) { var m = String(t || '').match(/重點\s*(\d+)\s*(.+)$/); return m ? { no: m[1], name: m[2] } : { no: '', name: String(t || '') }; }

/* ================= Paco（陪讀 IP） ================= */
var PACO_DIR = 'assets/paco/';
function paco(pose, cls) { return '<img class="paco ' + (cls || '') + '" src="' + PACO_DIR + pose + '.webp" alt="Paco" draggable="false">'; }
function pacoSay(pose, text, cls) { return '<div class="paco-say ' + (cls || '') + '">' + paco(pose) + '<div class="bubble">' + text + '</div></div>'; }
/* Paco 頭像（向量版，給導航列與小圖示用） */
var PACO_HEAD = '<svg class="paco-head" viewBox="0 0 64 64" aria-hidden="true">'
  + '<g stroke="#2E2A2A" stroke-width="2.4" stroke-linejoin="round">'
  + '<path d="M14 22 C10 10 18 6 24 14 Z" fill="#C97A43"/><path d="M50 22 C54 10 46 6 40 14 Z" fill="#C97A43"/>'
  + '<ellipse cx="32" cy="35" rx="23" ry="21" fill="#C97A43"/>'
  + '<path d="M11 40 C11 30 22 30 32 34 C42 30 53 30 53 40 C53 52 43 57 32 57 C21 57 11 52 11 40 Z" fill="#FCE3C6"/></g>'
  + '<path d="M17 18 C16 13 19 11 22 15 Z" fill="#F4C9A3"/><path d="M47 18 C48 13 45 11 42 15 Z" fill="#F4C9A3"/>'
  + '<path d="M21 9 l1 -4 M24 9 l2 -4 M43 9 l-1 -4 M40 9 l-2 -4" stroke="#2E2A2A" stroke-width="1.6" stroke-linecap="round"/>'
  + '<circle cx="23" cy="33" r="3" fill="#2E2A2A"/><circle cx="41" cy="33" r="3" fill="#2E2A2A"/>'
  + '<circle cx="24" cy="32" r="1" fill="#fff"/><circle cx="42" cy="32" r="1" fill="#fff"/>'
  + '<ellipse cx="32" cy="39" rx="3.2" ry="2.3" fill="#2E2A2A"/>'
  + '<path d="M28 44 Q32 47 36 44" fill="none" stroke="#2E2A2A" stroke-width="2" stroke-linecap="round"/>'
  + '<circle cx="18" cy="42" r="3.6" fill="#F3A99E" opacity=".85"/><circle cx="46" cy="42" r="3.6" fill="#F3A99E" opacity=".85"/></svg>';

/* 線條圖示（導航列與頁首共用） */
function svgI(p) { return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
var ICON = {
  star: svgI('<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>'),
  wrong: svgI('<path d="M6.5 3.5H17a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8.5 3.5v17"/><path d="M11.5 9.5l4.5 4.5M16 9.5L11.5 14"/>'),
  flag: svgI('<path d="M5.5 21V4"/><path d="M5.5 4.8c4.2-2.2 7.3 2.2 12.5 0v8.4c-5.2 2.2-8.3-2.2-12.5 0"/>'),
  map: svgI('<path d="M3.5 6.6L9 4.2l6 2.4 5.5-2.4v13.2L15 19.8l-6-2.4-5.5 2.4z"/><path d="M9 4.2v13.2M15 6.6v13.2"/>'),
  chart: svgI('<path d="M4 4v15.5h16"/><path d="M7.5 14.5l3.5-4 3 2.5 4.5-6"/><circle cx="18.5" cy="7" r=".6" fill="currentColor"/>')
};

/* ================= 學習足跡（學習地圖用） ================= */
/* seen[id] = [作答次數, 答對次數, 最後作答(秒)]；papers[id] = { b: 最佳, l: 最近, n: 次數, t: 時間 } */
function bumpSeen(s, id, ok, ts) {
  var x = s[id] || [0, 0, 0];
  x[0]++; if (ok) x[1]++; x[2] = Math.max(x[2], Math.round(ts / 1000));
  s[id] = x;
}
function bumpPaper(p, pid, score, ts) {
  var x = p[pid] || { b: 0, l: 0, n: 0, t: 0 };
  x.b = Math.max(x.b, score); x.n++; if (ts >= x.t) { x.t = ts; x.l = score; }
  p[pid] = x;
}
/* 第一次使用時，由既有作答紀錄回推 */
function getSeen() {
  var s = store.get(KEY.seen, null);
  if (s) return s;
  s = {};
  store.get(KEY.his, []).slice().reverse().forEach(function (r) {
    (r.detail || []).forEach(function (d) {
      var raw = rawById(d.id); if (!raw || d.k == null) return;
      var p = (d.p && d.p.length === 4) ? d.p : [0, 1, 2, 3];
      bumpSeen(s, d.id, d.k === p.indexOf(raw.answer), r.ts);
    });
  });
  store.set(KEY.seen, s);
  return s;
}
function getPaperLog() {
  var p = store.get(KEY.papers, null);
  if (p) return p;
  p = {};
  store.get(KEY.his, []).slice().reverse().forEach(function (r) { if (r.paper) bumpPaper(p, r.paper, r.score, r.ts); });
  store.set(KEY.papers, p);
  return p;
}
function mergeSeen(c) {
  var s = getSeen();
  Object.keys(c || {}).forEach(function (k) { var a = s[k], b = c[k]; if (!a || (b && (b[0] > a[0] || (b[0] === a[0] && b[2] > a[2])))) s[k] = b; });
  store.set(KEY.seen, s);
}
function mergePapers(c) {
  var p = getPaperLog();
  Object.keys(c || {}).forEach(function (k) {
    var a = p[k], b = c[k]; if (!b) return;
    if (!a) { p[k] = b; return; }
    p[k] = { b: Math.max(a.b, b.b), n: Math.max(a.n, b.n), t: Math.max(a.t, b.t), l: b.t > a.t ? b.l : a.l };
  });
  store.set(KEY.papers, p);
}

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
      (p.questions || []).forEach(function (q, i) { _IDX[p.id + '#' + (i + 1)] = paperRaw(p, q, i); });
    });
  }
  return _IDX[id] || null;
}
/* 試卷題目：qids 引用題庫題號，或 questions 直接內嵌題目 */
function paperRaw(p, q, i) {
  return { id: p.id + '#' + (i + 1), exam: p.exam, subject: '', topic: '官方題庫 ─ ' + (p.yCE ? p.yCE + ' 年' : p.label), kind: 'off', difficulty: 2,
    q: q.q, options: q.options, answer: q.answer, explain: ['', '', '', ''], note: q.note || '',
    src: p.examName + ' ' + p.label + (p.yROC ? '（民國 ' + p.yROC + ' 年／西元 ' + p.yCE + ' 年）' : '') };
}
function paperQs(p) {
  if (p.qids) return p.qids.map(rawById).filter(Boolean);
  return p.questions.map(function (q, i) { return paperRaw(p, q, i); });
}
function paperRange(id) {
  var n = papersOf(id).map(function (p) { return p.sess; }).filter(Boolean).sort(function (a, b) { return a - b; });
  return n.length ? n[0] + '～' + n[n.length - 1] : '';
}
function paperGroup(p) { return p.era || ('民國 ' + p.yROC + ' 年（西元 ' + p.yCE + '）'); }

/* 原始題目 → 作答用題目（可打散選項；perm[i] = 第 i 個顯示選項對應的原始索引） */
function toItem(raw, keepOrder) {
  var perm = keepOrder ? [0, 1, 2, 3] : shuffle([0, 1, 2, 3]);
  return {
    id: raw.id, exam: raw.exam || '', subject: raw.subject || '', topic: raw.topic || '綜合', kind: kindOf(raw),
    q: raw.q, opts: perm.map(function (i) { return raw.options[i]; }),
    exps: perm.map(function (i) { return (raw.explain && raw.explain[i]) || ''; }),
    ans: perm.indexOf(raw.answer), src: raw.src || '', note: raw.note || '', nv: raw.nv ? 1 : 0, perm: perm
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
/* 綜合模擬考：自官方歷屆試題中，依各分類「平均」出題（題數不足的分類，缺額由其他分類補足） */
function mockPool(id) { var off = dedup(poolOf(id, 'off')), all = dedup(bankOf(id)), e = examById(id); return off.length >= Math.min(all.length, e ? e.qn : 1) ? off : all; }
function balancedPlan(id, n) {
  var pool = mockPool(id), by = {}, keys = [];
  pool.forEach(function (q) { var t = q.topic || '綜合'; if (!by[t]) { by[t] = []; keys.push(t); } by[t].push(q); });
  var plan = keys.map(function (t) { return { t: t, avail: by[t].length, n: 0, qs: by[t] }; });
  var order = plan.slice().sort(function (a, b) { return b.avail - a.avail; });
  var left = Math.min(n, pool.length);
  while (left > 0) {
    var moved = false;
    for (var i = 0; i < order.length && left > 0; i++) if (order[i].n < order[i].avail) { order[i].n++; left--; moved = true; }
    if (!moved) break;
  }
  return plan;
}
function drawBalanced(id, n) {
  var out = [];
  balancedPlan(id, n).forEach(function (p) { out = out.concat(shuffle(p.qs).slice(0, p.n)); });
  return shuffle(out).map(function (q) { return toItem(q); });
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
  S.from = { v: curView, a: curArgs };
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
  // 學習足跡：每題作答次數／答對次數、歷屆試卷成績
  var seen = getSeen(), now = Date.now();
  S.qs.forEach(function (q, i) { if (S.picked[i] != null) bumpSeen(seen, q.id, S.picked[i] === q.ans, now); });
  store.set(KEY.seen, seen);
  if (S.paper) { var pl = getPaperLog(); bumpPaper(pl, S.paper, S.score, now); store.set(KEY.papers, pl); }
  scheduleSync();
  if (auto) openModal('時間到', '測驗時間已結束，系統已自動交卷。', '<button class="btn btn-pri" data-act="toResults">查看成績</button>');
  else vResults();
}

/* ================= 導覽（回上一頁） ================= */
var NAV = [], curView = 'home', curArgs = {};
function setView(v, a) { curView = v; curArgs = a || {}; renderAcct(); updateFab(); navShow(!(v === 'exam' && window.innerWidth <= 900)); }
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
    case 'scores': return vScores(a.id, a.f);
    case 'wrongs': return vWrongAll(a.f, a.t);
    case 'map': return vMap(a.id);
    default: return vHome();
  }
}
/* 作答中離開（導航列、返回鍵）一律先確認；進度保留於本機，可從首頁接續 */
var pendingLeave = null;
function guardLeave(fn) {
  if (curView === 'exam' && S && !S.done) {
    pendingLeave = fn;
    openModal('要離開作答畫面嗎？', '<p>目前的作答進度會自動保留，之後可從首頁「繼續作答」接續。'
      + (S.mode === 'mock' ? '<br><b>提醒：模擬考計時不會暫停。</b>' : '') + '</p>',
      '<button class="btn btn-ghost" data-act="modalClose">繼續作答</button><button class="btn btn-pri" data-act="leaveYes">確定離開</button>');
    return;
  }
  fn();
}
function goFrom(fr) {
  var a = (fr && fr.a) || {};
  switch (fr && fr.v) {
    case 'intro': return vIntro(a.id);
    case 'custom': return vCustom(a.id);
    case 'papers': return vPapers(a.id, a.tab, a.sub);
    case 'marks': return vMarks(a.f || '');
    case 'wrongs': return vWrongAll(a.f, a.t);
    case 'map': return vMap(a.id);
    case 'scores': return vScores(a.id, a.f);
    default: return vHome();
  }
}
function pageHead(title, sub, pose) {
  return '<header class="phead">' + (pose ? paco(pose, 'phead-paco') : '') + '<div><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div></header>';
}
function mapTabs(cur, id) {
  return '<div class="ptabs"><button class="' + (cur === 'map' ? 'on' : '') + '" data-act="mapTab" data-id="' + esc(id || '') + '">' + ICON.map + '學習路線</button>'
    + '<button class="' + (cur === 'scores' ? 'on' : '') + '" data-act="scTab" data-id="' + esc(id || '') + '">' + ICON.chart + '成績單</button></div>';
}
function examTabs(act, cur, counter) {
  return '<div class="bankf etabs">' + META.exams.map(function (e) {
    var c = counter ? counter(e.id) : null;
    return '<button class="' + (e.id === cur ? 'on' : '') + '" data-act="' + act + '" data-id="' + e.id + '">' + esc(e.short) + (c != null ? '（' + c + '）' : '') + '</button>';
  }).join('') + '</div>';
}
function setHTML(h) { app.innerHTML = h; window.scrollTo(0, 0); lastY = 0; updateFab(); renderAcct(); }
function backBar(title, extra) {
  return '<div class="pagebar"><button class="btn btn-ghost btn-sm" data-act="back">← 回上一頁</button><b>' + title + '</b><span class="sp"></span>'
    + (extra || '') + '<button class="btn btn-ghost btn-sm" data-act="home">回首頁</button></div>';
}

/* ================= 題目卡片（檢討／收藏／題庫瀏覽共用） ================= */
function offNote(item) {
  var y = (String(item.topic || '').match(/(\d{4})\s*年/) || [])[1], meta;
  if (item.kind === 'book') meta = '本題出自' + esc(String(item.subject || '').split('｜')[0] || '書籍題庫') + '，綠色標示為標準答案。';
  else meta = '本題為官方歷屆試題' + (y ? '（' + y + ' 年）' : '') + '，綠色標示為官方標準答案。' + ((!y || +y < 2025) ? '答案依當期法規；若相關法規其後已修正，請以最新規定為準。' : '');
  return (item.note ? noteHtml(item) : '') + '<div class="qmeta">備註：' + meta + (item.src ? '<br>依據：' + fmtTxt(item.src) : '') + '</div>';
}
/* 官方題目之解析為本站整理；nv＝涉及條號、金額、比例等細節，提醒對照最新法規 */
function noteHtml(item) {
  return '<div class="offexp"><b>解析</b><span class="nsrc">本站整理</span>　' + fmtTxt(item.note) + '</div>'
    + (item.nv ? '<div class="nvnote">⚠️ 本解析涉及之條號、金額或比例係依當期法規整理，建議對照最新規定。</div>' : '');
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
  else if (showAns) h += (item.note ? '<div class="offexp"><b>解析</b>　' + fmtTxt(item.note) + '</div>' : '') + (item.src ? '<div class="qmeta">依據：' + fmtTxt(item.src) + '</div>' : '');
  return h;
}
function markBtn(id, act, extra) {
  var on = isMarked(id);
  return '<button class="qmark' + (on ? ' on' : '') + '" data-act="' + act + '" data-id="' + esc(id) + '"' + (extra || '') + ' title="收藏複習：永久保存，可從導航列「收藏」隨時回顧">' + (on ? '★ 已收藏' : '☆ 收藏') + '</button>';
}
function tags(item) {
  return (item.subject ? '<span class="qtag">' + esc(item.subject) + '</span>' : '') + '<span class="qtag">' + esc(item.topic) + '</span>';
}

/* ================= 首頁 ================= */
/* 仍只有示範題的科目 */
function demoExams() {
  return (META.exams || []).filter(function (e) { var b = bankOf(e.id); return b.length && b.every(function (q) { return /^DEMO-/.test(q.id); }); });
}
function vHome() {
  clearInterval(timerId); timerId = null; S = null; sheetOpen = false; NAV = []; setView('home');
  if (!META) { setHTML('<div class="panel" style="text-align:center"><h2>題庫建置中</h2><p class="notice">資料尚未載入，請稍後重新整理。</p></div>'); return; }
  var saved = store.get(KEY.ses, null), his = store.get(KEY.his, []), h = '';
  var real = META.exams.filter(function (e) { return demoExams().indexOf(e) < 0; }), nQ = 0, nP = 0, tps = {};
  real.forEach(function (e) { nQ += bankOf(e.id).length; nP += papersOf(e.id).length; bankOf(e.id).forEach(function (q) { tps[e.id + q.topic] = 1; }); });
  var tl = String(META.title), cut = tl.indexOf('證照');
  h += '<header class="brand"><div class="brand-main"><div class="eyebrow"><span class="brand-badge">' + PACO_HEAD + '</span>TRUST & FUTURES　電腦應試模擬</div>'
    + '<h1>' + (cut > 0 ? '<span class="t1">' + esc(tl.slice(0, cut)) + '</span><em>' + esc(tl.slice(cut)) + '</em>' : esc(tl)) + '</h1>'
    + '<p class="sub">信託業業務人員信託業務專業測驗・期貨商業務員資格測驗</p>'
    + '<div class="bstats"><div><b class="num">' + nQ.toLocaleString() + '</b><span>官方歷屆試題</span></div><div><b class="num">' + nP + '</b><span>份整卷</span></div><div><b class="num">' + Object.keys(tps).length + '</b><span>章節分類</span></div></div></div>'
    + '<div class="brand-art"><div class="bubble">Paco 陪你一起讀書吧！</div>' + paco('wave', 'brand-paco') + '<span class="art-tag">STUDY WITH PACO</span></div></header>';
  var demo = demoExams();
  if (demo.length) h += '<div class="demo-banner">🧪 <b>' + demo.map(function (e) { return esc(e.name); }).join('、') + '</b> 目前為示範題（每科僅數題，用於展示功能），正式題庫匯入後此提示會自動消失。</div>';
  if (saved && saved.qs && saved.qs.length) {
    var se = examById(saved.examId);
    h += '<div class="resume">' + paco('study', 'resume-paco') + '<p>偵測到未完成的<b>《' + esc(saved.label || (se ? se.short : saved.examId)) + '》' + (saved.mode === 'mock' ? '模擬考' : '練習') + '</b>（已作答 '
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
      var dis = bn ? '' : ' disabled';
      h += '<div class="ecard ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h3>' + esc(e.name) + '</h3>'
        + '<p class="admin">' + esc(e.admin) + '</p>'
        + '<div class="chips"><span class="chip"><b class="num">' + e.qn + '</b> 題</span><span class="chip"><b class="num">' + e.min + '</b> 分鐘</span>'
        + '<span class="chip">及格 <b class="num">' + e.pass + '</b></span><span class="chip">題庫 <b class="num">' + bn + '</b></span></div>'
        + (last ? '<div class="last num">上次模擬 ' + last.score + ' 分 ─ 最佳 ' + best.score + ' 分</div>' : '')
        + '<div class="acts"><div class="arow arow3">'
        + '<button class="btn btn-ghost" data-act="custom" data-id="' + e.id + '"' + dis + '>自訂練習</button>'
        + '<button class="btn btn-ghost" data-act="papers" data-id="' + e.id + '"' + (hasArchive ? '' : ' disabled') + '>' + (poolOf(e.id, 'book').length ? '歷屆／書籍題庫' : '官方歷屆試題') + '</button>'
        + '<button class="btn btn-pri" data-act="intro" data-id="' + e.id + '"' + dis + '>綜合模擬考</button></div>'
        + '<div class="arow arow2"><button class="btn btn-ghost btn-sm" data-act="bankOpen" data-id="' + e.id + '"' + dis + '>題庫瀏覽</button>'
        + '<button class="btn btn-ghost btn-sm" data-act="wrongMenu" data-id="' + e.id + '"' + (anyWrong ? '' : ' disabled') + '>錯題重練</button></div>'
        + '</div></div>';
    });
    h += '</div>';
  });
  h += '<div class="hist home-hist"><div class="hhead"><h3>歷史作答紀錄</h3><span class="sp"></span>'
    + (his.length ? '<button class="btn btn-ghost btn-sm" data-act="clearAllAsk">清除作答紀錄</button>' : '') + '</div>';
  if (!his.length) h += '<div class="mhint">還沒有作答紀錄，完成一次練習或模擬考後就會出現在這裡。</div>';
  else {
    h += '<div class="tw"><table><tr><th>時間</th><th>測驗</th><th>模式</th><th>成績</th><th>結果</th><th></th></tr>';
    his.slice(0, 10).forEach(function (r, i) {
      var e = examById(r.examId), pp = r.paper ? paperById(r.paper) : null;
      h += '<tr class="num"><td>' + fmtDate(r.ts) + '</td><td>' + esc(e ? e.short : r.examId) + (pp ? ' <span class="hpaper">' + esc(pp.label) + '</span>' : '') + '</td>'
        + '<td>' + modeName(r) + '</td><td>' + r.score + ' 分（' + r.correct + '/' + r.total + '）</td>'
        + '<td>' + (r.pass == null ? '—' : (r.pass ? '<span class="pass-y">及格</span>' : '<span class="pass-n">未及格</span>')) + '</td>'
        + '<td>' + (r.detail ? '<button class="linkbtn" data-act="hisView" data-i="' + i + '">檢視題目</button>' : '') + '</td></tr>';
    });
    h += '</table></div>' + (his.length > 10 ? '<div class="mhint">只顯示最近 10 筆，完整紀錄與成績曲線請到「學習地圖 → 成績單」。</div>' : '');
  }
  h += '</div>';
  h += '<footer class="foot"><div class="disc"><b>資料來源與聲明：</b>'
    + '<div>信託業務專業測驗：題目全部為金研院公布之官方歷屆試題（附官方正確答案），官方送分、一題多解或已刪除之題目不納入。</div>'
    + '<div>期貨商業務員：題庫建置中（目前為示範題）。</div>'
    + '<div class="i">考試制度依主辦單位最新電腦應試簡章設定（資料更新：' + esc(META.updated) + '）。</div>'
    + '<div class="i">官方歷屆試題之答案依主辦單位公布之正確答案；解析與主題分類為本站依測驗範圍整理，僅供學習參考。</div>'
    + '<div class="i">早期試題若涉及已修正法規，請以最新法規為準；實際規定以主辦單位公告為準。</div></div>';
  (META.sources || []).forEach(function (s) { h += '<p>─ <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></p>'; });
  h += '</footer>';
  setHTML(h);
}
function modeName(r) {
  if (r.mode === 'mock') {
    if (r.paper) return '歷屆考題';
    if (r.type === 'weighted') return '模擬考（書籍題庫）';
    return '綜合模擬考';
  }
  return { marks: '收藏題練習', wrong: '錯題重練', chapter: '分章練習', map: '學習地圖練習' }[r.type] || '練習';
}

/* ================= 綜合模擬考說明 ================= */
function vIntro(id) {
  var e = examById(id), n = Math.min(e.qn, mockPool(id).length), plan = balancedPlan(id, e.qn), offN = poolOf(id, 'off').length;
  var h = '<div class="panel intro ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span>'
    + '<div class="intro-top"><div><h2>綜合模擬考</h2><p class="admin">' + esc(e.name) + '｜' + esc(e.admin) + '</p></div>'
    + pacoSay('study', '我會從' + (offN ? '官方歷屆試題' : '題庫') + '的 <b>' + plan.length + ' 個分類</b>平均出題，就像真的考試一樣！', 'intro-paco') + '</div>'
    + '<div class="ktiles"><div class="ktile"><span>題數</span><b class="num">' + n + '</b><i>題</i></div>'
    + '<div class="ktile"><span>時間</span><b class="num">' + e.min + '</b><i>分鐘</i></div>'
    + '<div class="ktile"><span>及格</span><b class="num">' + e.pass + '</b><i>分</i></div>'
    + '<div class="ktile"><span>計分</span><b class="num">' + (Math.round(1000 / Math.max(1, e.qn)) / 10) + '</b><i>分／題</i></div>'
    + '<div class="ktile ' + (/禁止/.test(e.calc) ? 'kno' : 'kyes') + '"><span>計算器</span><b>' + (/禁止/.test(e.calc) ? '禁用' : '可用') + '</b><i>' + (/禁止/.test(e.calc) ? '' : '簡易型') + '</i></div></div>'
    + '<div class="flabel">出題分布<span class="flsub">每次重新抽題、打散選項</span></div><div class="dist">'
    + plan.map(function (p) { var s = tShort(p.t); return '<div class="drow"><span class="dno">' + esc(s.no || '•') + '</span><span class="dname">' + esc(s.name) + '</span><b class="num">' + p.n + ' 題</b></div>'; }).join('') + '</div>'
    + (mockPool(id).length < e.qn ? '<p class="srcnote">⚠️ 目前題庫僅 ' + mockPool(id).length + ' 題，少於正式題數，本次以現有題目出題。</p>' : '')
    + '<ul class="kpoints"><li>⏱ 時間到自動交卷，答錯不倒扣</li><li>🚩 可標記題目、用答題卡跳題</li><li>💾 進度自動暫存，可從首頁接續</li></ul>'
    + '<details class="more"><summary>完整考試規則</summary><dl class="rules"><dt>題型</dt><dd>' + esc(e.split) + '</dd>'
    + '<dt>及格標準</dt><dd class="num">' + e.pass + ' 分合格；單科不得低於 ' + e.floor + ' 分</dd>'
    + '<dt>計算器</dt><dd>' + esc(e.calc) + '</dd>' + (e.scope ? '<dt>測驗範圍</dt><dd>' + esc(e.scope) + '</dd>' : '')
    + '<dt>備註</dt><dd>' + esc(e.passNote) + '</dd><dt>快捷鍵</dt><dd>1–4 或 A–D 選答、← → 換題、F 標記</dd></dl></details>'
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
  var h = '<div class="panel ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span>' + pacoSay('happy', '選好題數和分類，我陪你一題一題練！', 'panel-paco') + '<h2>自訂練習｜' + esc(e.short) + '</h2>'
    + '<p class="admin">不計時 ─ 每題作答後立即顯示解析，適合分主題複習（題庫共 ' + pool.length + ' 題）</p>'
    + '<div class="flabel">練習題數</div><div class="seg" id="segN">'
    + [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(function (n) { return '<button data-act="setN" data-n="' + n + '"' + (n === 20 ? ' class="on"' : '') + '>' + n + ' 題</button>'; }).join('')
    + '<button data-act="setN" data-n="0">全部範圍</button></div>'
    + '<div class="flabel">題目順序</div><div class="seg" id="segO"><button class="on" data-act="setOrd" data-o="0">隨機打散</button><button data-act="setOrd" data-o="1">照原本順序（含選項）</button></div>'
    + '<div class="flabel">練習範圍（不選＝全部主題）</div>';
  subs.forEach(function (s) {
    if (s) h += '<div class="subhead">' + esc(s) + '</div>';
    h += '<div class="tchips">' + bySub[s].map(function (t) { var sh = tShort(t); return '<button data-act="tgTopic" data-t="' + esc(t) + '">' + (sh.no ? '<i>' + sh.no + '</i>' : '') + esc(sh.name) + '（' + cnt[t] + '）</button>'; }).join('') + '</div>';
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
  var h = '<div class="panel ' + hueCls(e) + '"><span class="ebadge">' + esc(e.badge) + '</span><h2>' + (hasBook ? '歷屆／書籍題庫' : '官方歷屆試題') + ' ─ ' + esc(e.short) + '</h2><div class="bankf">'
    + (hasBook ? '<button class="' + (tab === 'book' ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="book">📚 ' + esc(e.bookName || '書籍題庫') + '（' + totBook + '）</button>' : '')
    + (hasBook ? '<button class="' + (tab === 'off' ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="off">📄 歷屆考題（' + ps.length + ' 份）</button>' : '<span class="mkhint">共 ' + ps.length + ' 份整卷，依官方題序作答，題數與時間比照正式考試。</span>') + '</div>';
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
    // 依年份（或 era 分組名稱）分組，新的在前
    var byY = {}, years = [];
    ps.slice().sort(function (a, b) { return (b.yROC || 0) - (a.yROC || 0) || (b.sess || 0) - (a.sess || 0); }).forEach(function (p) {
      var g = paperGroup(p);
      if (!byY[g]) { byY[g] = []; years.push(g); }
      byY[g].push(p);
    });
    if (sub && years.indexOf(sub) < 0) sub = '';
    if (years.length > 1) {
      h += '<div class="bankf sub"><button class="' + (sub ? '' : 'on') + '" data-act="pTab" data-id="' + id + '" data-tab="off" data-sub="">全部（' + ps.length + '）</button>'
        + years.map(function (y) { return '<button class="' + (sub === y ? 'on' : '') + '" data-act="pTab" data-id="' + id + '" data-tab="off" data-sub="' + esc(y) + '">' + esc(y.replace(/^民國 /, '').replace(/（西元 \d+）/, '').replace(/（試題未標示年份）/, '')) + '（' + byY[y].length + '）</button>'; }).join('') + '</div>';
    }
    years.forEach(function (y) {
      if (sub && sub !== y) return;
      if (!sub) h += '<div class="subhead">' + esc(y) + '</div>';
      h += '<div class="plist">' + byY[y].map(function (p) {
        var tip = (p.dropped || []).map(function (d) { return '第 ' + d.no + ' 題：' + d.why; }).join('；');
        return '<button class="wrow" data-act="startPaper" data-paper="' + esc(p.id) + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span>' + esc(p.label)
          + (p.dropped ? ' <span class="ppartial">已排除 ' + p.dropped.length + ' 題（官方送分或刪除）</span>' : (p.qn < e.qn ? ' <span class="ppartial">部分卷</span>' : '')) + '</span><b class="num">' + p.qn + ' 題</b></button>';
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
    return S.src && S.src !== 'all' ? '模擬考 ─ ' + srcName(S.src) : '綜合模擬考';
  }
  return { marks: '收藏題練習', wrong: '錯題重練', chapter: '分章練習', map: '學習地圖' }[S.type] || '練習模式';
}
function vExam() {
  var e = examById(S.examId), q = S.qs[S.idx], mock = S.mode === 'mock';
  var revealed = !mock && S.shown[S.idx];
  var h = '<div class="' + hueCls(e) + '"><div class="exam-top"><button class="btn btn-ghost btn-sm xback" data-act="examBack" title="返回上一頁（會先確認）">← 返回</button>'
    + '<span class="ttl">' + esc(sessionTitle()) + '</span><span class="mode">' + esc(sessionMode()) + '</span>'
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
    h += '<div class="fb">' + verdictHtml(hit, q.ans)
      + '<div class="fbnav"><button class="btn btn-ghost btn-sm" data-act="retryQ">🔁 當題重新作答</button><span class="sp"></span>'
      + (S.idx === S.total - 1 ? '<button class="btn btn-pri btn-sm" data-act="submitAsk">結束並看結果 →</button>' : '<button class="btn btn-pri btn-sm" data-act="next">下一題 →</button>') + '</div>';
    if (hasOptExp(q)) {
      h += '<ul>' + q.exps.map(function (x, j) { return '<li class="' + (j === q.ans ? 'hit' : '') + '"><b>' + L(j) + (j === q.ans ? ' ✓' : ' ✗') + '</b><span>' + fmtTxt(x || '') + '</span></li>'; }).join('') + '</ul>';
      if (q.note) h += '<div class="offexp"><b>解析</b>　' + fmtTxt(q.note) + '</div>';
      if (q.src) h += '<div class="qmeta">依據：' + fmtTxt(q.src) + '</div>';
    } else h += offNote(q);
    h += '</div>';
  }
  h += '<div class="qnav"><button class="btn btn-ghost" data-act="prev"' + (S.idx === 0 ? ' disabled' : '') + '>← 上一題</button><span class="sp"></span>'
    + (revealed ? '' : '<button class="btn btn-ghost" data-act="next"' + (S.idx === S.total - 1 ? ' disabled' : '') + '>下一題 →</button>') + '</div></div></div>';
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
  var good = mock ? S.pass : S.score >= 70;
  var h = '<div class="' + hueCls(e) + '"><div class="result-hero">' + paco(good ? 'cheer' : 'thumb', 'r-paco') + '<div class="score-big"><span class="v num">' + S.score + '</span><span class="d">／100</span></div>'
    + (mock ? '<div><span class="stamp ' + (S.pass ? 'pass">及 格' : 'fail">未及格') + '</span></div>' : '')
    + '<div class="rmeta"><h2>' + esc(sessionTitle()) + '｜' + (mock ? '模擬考成績單' : '練習結果') + '</h2><div class="row">'
    + '<span class="chip">答對 <b class="num">' + S.correct + '</b>／' + S.total + ' 題</span><span class="chip">答錯 <b class="num">' + wrong + '</b> 題</span>'
    + '<span class="chip">未答 <b class="num">' + skip + '</b> 題</span><span class="chip">用時 <b class="num">' + fmtClock(used) + '</b></span>'
    + (mock ? '<span class="chip">參考及格 <b class="num">' + e.pass + '</b> 分</span>' : '')
    + (mock && S.score < e.floor ? '<span class="chip" style="color:var(--bad)">低於單科最低 <b class="num">' + e.floor + '</b> 分</span>' : '') + '</div>'
    + '<p class="rsay">' + (good ? (mock ? '恭喜及格！保持這個節奏，正式考試沒問題！' : '表現很棒！挑戰一下綜合模擬考吧！') : '再接再厲！先看錯題檢討，下次一定更好！') + '</p></div></div>';
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
  if (!n) h += '<div class="panel empty">' + paco('cheer', 'empty-paco') + '<h2>全數答對！</h2><p class="notice">本次作答沒有錯題，繼續保持。</p></div>';
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
  NAV = [];
  var h = pageHead(ICON.star + '收藏　<span class="num pcount" id="mkCnt">' + marks.length + '</span> 題', '作答、檢討或瀏覽題庫時按「☆ 收藏」，題目就會存在這裡，隨時複習。', 'happy');
  if (!marks.length) {
    setHTML(h + '<div class="mempty">' + pacoSay('happy', '還沒有收藏任何題目喔！遇到想再看一次的題目，就按右上角的「☆ 收藏」吧。', 'empty-say') + '</div>');
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
  h += practBox('mkPractice', 'data-f="' + esc(f) + '"', shown.length)
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

/* 收藏／錯題：依考科隨機抽 10～50 題練習 */
var practN = 20;
function practBox(act, attrs, total) {
  if (!total) return '';
  var opts = [10, 20, 30, 40, 50].filter(function (n, i) { return i === 0 || n <= total || [10, 20, 30, 40, 50][i - 1] < total; });
  return '<div class="pbox"><span class="pbl">隨機抽題練習</span><div class="seg" id="segPN">'
    + opts.map(function (n) { return '<button data-act="setPN" data-n="' + n + '"' + (practN === n ? ' class="on"' : '') + '>' + n + ' 題</button>'; }).join('')
    + '<button data-act="setPN" data-n="0"' + (practN === 0 ? ' class="on"' : '') + '>全部 ' + total + ' 題</button></div>'
    + '<button class="btn btn-pri" data-act="' + act + '" ' + attrs + '>▶ 開始練習</button></div>';
}
function pickN(list) { list = shuffle(list); return practN ? list.slice(0, practN) : list; }

/* ================= 標記（考試中不確定、待檢查的題目） ================= */
/* 標記題卡片：未交卷時可直接在這裡作答（不必逐題「跳到此題」） */
function verdictHtml(hit, ansIdx) {
  return '<div class="verdict-row">' + paco(hit ? 'thumb' : 'study', 'v-paco') + '<div class="verdict ' + (hit ? 'ok' : 'bad') + '">' + (hit ? '答對了！' : '答錯了，正確答案是 ' + L(ansIdx)) + '</div></div>';
}
function flagCards(src, inExam) {
  var e = examById(src.examId), h = '';
  curFlags(src).forEach(function (i) {
    var q = src.qs[i], pk = src.picked[i], practice = src.mode === 'practice', revealed = src.done || (practice && src.shown[i]);
    h += '<div class="ovcard fcard ' + hueCls(e) + '"><div class="ovhead"><span class="mbadge">第 ' + (i + 1) + ' 題</span>' + tags(q)
      + '<span class="fst ' + (pk == null ? 'no' : 'yes') + '">' + (pk == null ? '未作答' : '已作答') + '</span><span class="sp"></span>'
      + (src.done ? '' : '<button class="ovx" data-act="flagOff" data-q="' + i + '">取消標記</button>') + (inExam && !src.done ? '<button class="ovgo" data-act="flagJump" data-i="' + i + '">跳到此題 →</button>' : '') + '</div>'
      + '<p class="ovq">' + esc(q.q) + '</p>';
    if (src.done) h += optionRows(q, pk, true);
    else {
      h += '<div class="opts">';
      for (var j = 0; j < 4; j++) {
        var cls = 'opt';
        if (revealed) { if (j === q.ans) cls += ' is-ans'; else if (pk === j) cls += ' is-wrong'; }
        else if (pk === j) cls += ' sel';
        h += '<button class="' + cls + '" data-act="flagPick" data-q="' + i + '" data-o="' + j + '"' + (revealed ? ' disabled' : '') + '><span class="k">' + L(j) + '</span><span>' + esc(q.opts[j]) + '</span></button>';
      }
      h += '</div>';
      if (revealed) h += '<div class="fb">' + verdictHtml(pk === q.ans, q.ans) + (hasOptExp(q) ? '' : offNote(q)) + '</div>';
    }
    h += '</div>';
  });
  return h;
}
function refreshFlags() {
  var ov = document.getElementById('movl');
  if (ov && !ov.hidden) { var b = document.getElementById('movlBody'), y = b.scrollTop; openFlags(); b.scrollTop = y; }
  else if (curView === 'flags') { var wy = window.scrollY; vFlags(); window.scrollTo(0, wy); }
  updateFab();
}
function vFlags() {
  NAV = [];
  var src = flagSrc(), fl = curFlags(src), e = src ? examById(src.examId) : null;
  var h = pageHead(ICON.flag + '標記', '考試時不確定的題目，按「🚩 標記」就會收在這裡；完成考試並檢討後回到首頁，這些標記會自動清除。', 'study');
  if (!fl.length) {
    setHTML(h + '<div class="mempty">' + pacoSay('study', '目前沒有標記的題目。作答時遇到沒把握的題目，按右上角的「🚩 標記」（或鍵盤 F）就可以先記下來。', 'empty-say') + '</div>');
    setView('flags', {}); return;
  }
  var title = src.label || (e ? e.short : '');
  h += '<div class="mkact"><span class="flsrc"><b>' + esc(title) + '</b>　' + (src.done ? '已交卷' : '作答中（已作答 ' + src.picked.filter(function (p) { return p != null; }).length + '／' + src.total + '）') + '・標記 ' + fl.length + ' 題</span><span class="sp"></span>'
    + (src.done ? '<button class="btn btn-ghost" data-act="toResults">回成績單</button>' : '<button class="btn btn-pri" data-act="resume">回到作答</button>') + '</div>';
  if (!src.done) h += '<p class="mhint">可以直接在這裡作答標記的題目，答案會同步到原本的測驗' + (src.mode === 'mock' ? '（模擬考交卷前不顯示正確答案；計時仍在進行）' : '') + '。</p>';
  h += flagCards(src, false);
  setHTML(h); setView('flags', {});
}

/* ================= 錯題本（統整所有作答紀錄的錯題） ================= */
var wrongShow = 30;
function vWrongAll(f, t, keepShow) {
  NAV = []; if (!keepShow) wrongShow = 30;
  var all = activeWrongAll(), cnt = {};
  all.forEach(function (x) { cnt[x.exam] = (cnt[x.exam] || 0) + 1; });
  if (!f || !examById(f)) f = (META.exams.filter(function (e) { return cnt[e.id]; })[0] || META.exams[0]).id;
  var e = examById(f), mine = all.filter(function (x) { return x.exam === f; }).sort(function (a, b) { return b.w - a.w; });
  var byT = {}, tOrder = [];
  bankOf(f).forEach(function (q) { if (byT[q.topic] == null) { byT[q.topic] = 0; tOrder.push(q.topic); } });
  mine.forEach(function (x) { var q = rawById(x.id); if (q) byT[q.topic] = (byT[q.topic] || 0) + 1; });
  var h = pageHead(ICON.wrong + '錯題本', '統整所有練習與模擬考中答錯、尚未訂正的題目；之後在任何練習中答對，就會自動移出。', 'thumb')
    + examTabs('wrTab', f, function (id) { return cnt[id] || 0; });
  if (!mine.length) {
    setHTML(h + '<div class="mempty">' + pacoSay('cheer', '「' + esc(e.short) + '」目前沒有錯題，太厲害了！', 'empty-say') + '</div>');
    setView('wrongs', { f: f, t: '' }); return;
  }
  if (t && !byT[t]) t = '';
  h += '<div class="wtopics"><button class="' + (t ? '' : 'on') + '" data-act="wrT" data-t="">全部 <b class="num">' + mine.length + '</b></button>'
    + tOrder.filter(function (x) { return byT[x]; }).map(function (x) { var s = tShort(x); return '<button class="' + (t === x ? 'on' : '') + '" data-act="wrT" data-t="' + esc(x) + '">' + (s.no ? '<i>' + s.no + '</i>' : '') + esc(s.name) + ' <b class="num">' + byT[x] + '</b></button>'; }).join('') + '</div>';
  var shown = mine.filter(function (x) { return !t || (rawById(x.id) || {}).topic === t; });
  h += practBox('wrPractice', 'data-id="' + f + '" data-t="' + esc(t) + '"', shown.length) + '<p class="mkhint">答對的題目會自動從錯題本移除。</p>';
  shown.slice(0, wrongShow).forEach(function (x) {
    var raw = rawById(x.id), it = viewOf(raw);
    h += '<div class="ovcard ' + hueCls(e) + '"><div class="ovhead"><span class="st bad">答錯</span>' + tags(it) + '<span class="wdate num">' + fmtDate(x.w) + '</span><span class="sp"></span>' + markBtn(x.id, 'markId') + '</div>'
      + '<p class="ovq">' + esc(it.q) + '</p>' + optionRows(it, undefined, true) + '</div>';
  });
  if (shown.length > wrongShow) h += '<div class="pgn"><button class="btn btn-ghost" data-act="wrMore">顯示更多（還有 ' + (shown.length - wrongShow) + ' 題）</button></div>';
  setHTML(h); setView('wrongs', { f: f, t: t });
}

/* ================= 成績單（模擬考成績變化） ================= */
function scoreChart(recs, e) {
  if (!recs.length) return '<div class="mempty">' + pacoSay('study', '還沒有模擬考紀錄喔！完成一次「綜合模擬考」或「官方歷屆試題」，這裡就會畫出你的成績曲線。', 'empty-say') + '</div>';
  var W = Math.max(300, Math.min(1000, (app.clientWidth || 700) - 50)), H = W < 500 ? 210 : 250, L = 40, R = 18, T = 18, B = 30, pw = W - L - R, ph = H - T - B, n = recs.length;
  function x(i) { return L + (n === 1 ? pw / 2 : pw * i / (n - 1)); }
  function y(v) { return T + ph * (1 - v / 100); }
  var g = '<svg class="schart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="模擬考成績變化圖">';
  [0, 20, 40, 60, 80, 100].forEach(function (v) { g += '<line class="sc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="sc-ax" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>'; });
  g += '<line class="sc-pass" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(e.pass) + '" y2="' + y(e.pass) + '"/><text class="sc-pt" x="' + (W - R) + '" y="' + (y(e.pass) - 6) + '" text-anchor="end">及格 ' + e.pass + '</text>';
  g += '<polyline class="sc-line" points="' + recs.map(function (r, i) { return x(i) + ',' + y(r.score); }).join(' ') + '"/>';
  recs.forEach(function (r, i) {
    var lab = fmtDate(r.ts) + '　' + (r.label || modeName(r)) + '　' + r.score + ' 分' + (r.pass == null ? '' : (r.pass ? '（及格）' : '（未及格）'));
    g += '<g class="sc-p"><title>' + esc(lab) + '</title><circle class="sc-hit" cx="' + x(i) + '" cy="' + y(r.score) + '" r="13"/><circle class="sc-dot' + (r.pass ? '' : ' miss') + '" cx="' + x(i) + '" cy="' + y(r.score) + '" r="5"/></g>';
    g += '<text class="sc-ax" x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + (i + 1) + '</text>';
  });
  var lr = recs[n - 1];
  g += '<text class="sc-last" x="' + Math.min(x(n - 1), W - R - 4) + '" y="' + (y(lr.score) - 12) + '" text-anchor="' + (n === 1 ? 'middle' : 'end') + '">' + lr.score + '</text>';
  return g + '</svg><p class="sc-cap">橫軸為第幾次模擬考（由舊到新，顯示最近 20 次）；將游標移到點上可看日期與試卷。</p>';
}
function vScores(id, f) {
  NAV = [];
  var his = store.get(KEY.his, []), cnt = {};
  his.forEach(function (r) { if (r.mode === 'mock') cnt[r.examId] = (cnt[r.examId] || 0) + 1; });
  if (!id || !examById(id)) id = (his[0] && examById(his[0].examId)) ? his[0].examId : META.exams[0].id;
  f = f || 'mock';
  var e = examById(id), mocks = his.filter(function (r) { return r.examId === id && r.mode === 'mock'; });
  var h = pageHead(ICON.map + '學習地圖', '記錄每一次模擬考的成績變化，看看自己進步了多少！', 'coin') + mapTabs('scores', id) + examTabs('scTab', id, function (x) { return cnt[x] || 0; });
  if (mocks.length) {
    var sum = 0, best = 0, pass = 0;
    mocks.forEach(function (r) { sum += r.score; best = Math.max(best, r.score); if (r.pass) pass++; });
    h += '<div class="ktiles stiles"><div class="ktile"><span>模擬次數</span><b class="num">' + mocks.length + '</b><i>次</i></div>'
      + '<div class="ktile"><span>最近一次</span><b class="num">' + mocks[0].score + '</b><i>分</i></div>'
      + '<div class="ktile"><span>最佳</span><b class="num">' + best + '</b><i>分</i></div>'
      + '<div class="ktile"><span>平均</span><b class="num">' + (Math.round(sum * 10 / mocks.length) / 10) + '</b><i>分</i></div>'
      + '<div class="ktile"><span>及格率</span><b class="num">' + Math.round(pass * 100 / mocks.length) + '</b><i>%</i></div></div>';
  }
  h += '<div class="tstats"><h3>' + esc(e.short) + '｜模擬考成績變化</h3>' + scoreChart(mocks.slice(0, 20).reverse(), e) + '</div>';
  var rows = his.map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { return x.r.examId === id && (f === 'all' || x.r.mode === 'mock'); });
  h += '<div class="hist"><div class="hhead"><h3>作答紀錄</h3><span class="sp"></span><div class="tabs"><button class="' + (f === 'mock' ? 'on' : '') + '" data-act="scF" data-f="mock">只看模擬考</button><button class="' + (f === 'all' ? 'on' : '') + '" data-act="scF" data-f="all">含練習</button></div></div>';
  if (!rows.length) h += '<div class="mhint">目前沒有紀錄。</div>';
  else {
    h += '<div class="tw"><table><tr><th>時間</th><th>測驗</th><th>模式</th><th>成績</th><th>結果</th><th></th></tr>';
    rows.forEach(function (x) {
      var r = x.r, pp = r.paper ? paperById(r.paper) : null;
      h += '<tr class="num"><td>' + fmtDate(r.ts) + '</td><td>' + esc(pp ? pp.label : (r.label || e.short)) + '</td>'
        + '<td>' + modeName(r) + '</td><td>' + r.score + ' 分（' + r.correct + '/' + r.total + '）</td>'
        + '<td>' + (r.pass == null ? '—' : (r.pass ? '<span class="pass-y">及格</span>' : '<span class="pass-n">未及格</span>')) + '</td>'
        + '<td>' + (r.detail ? '<button class="linkbtn" data-act="hisView" data-i="' + x.i + '">檢視題目</button>' : '') + '</td></tr>';
    });
    h += '</table></div>';
  }
  if (his.length) h += '<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-act="clearAllAsk">清除作答紀錄</button></div>';
  h += '</div>';
  setHTML(h); setView('scores', { id: id, f: f });
}

/* ================= 學習地圖（練過哪些分類、哪些歷屆試卷） ================= */
function vMap(id) {
  NAV = [];
  var seen = getSeen(), plog = getPaperLog(), his = store.get(KEY.his, []);
  if (!id || !examById(id)) id = (his[0] && examById(his[0].examId)) ? his[0].examId : META.exams[0].id;
  var e = examById(id), bank = dedup(bankOf(id)), st = [], idx = {};
  bank.forEach(function (q) {
    if (idx[q.topic] == null) { idx[q.topic] = st.length; st.push({ t: q.topic, n: 0, seen: 0, a: 0, c: 0 }); }
    var s = st[idx[q.topic]], x = seen[q.id]; s.n++;
    if (x) { s.seen++; s.a += x[0]; s.c += x[1]; }
  });
  var tot = 0, tseen = 0, ta = 0, tc = 0;
  st.forEach(function (s) { tot += s.n; tseen += s.seen; ta += s.a; tc += s.c; s.cov = s.n ? s.seen / s.n : 0; s.acc = s.a ? s.c / s.a : 0; });
  var next = st.slice().sort(function (a, b) { return a.cov - b.cov; })[0];
  var h = pageHead(ICON.map + '學習地圖', '一站一站走完所有分類！點選站牌，就從那一站出發練 20 題（優先出還沒練過的題目）。', '')
    + mapTabs('map', id) + examTabs('mapTab', id, null);
  var pct = tot ? Math.round(tseen * 100 / tot) : 0;
  h += '<div class="mapsum"><div class="ring" style="--p:' + pct + '"><b class="num">' + pct + '<i>%</i></b><span>題庫探索度</span></div>'
    + '<div class="msum-txt"><div>已練過 <b class="num">' + tseen + '</b> ／ ' + tot + ' 題</div><div>累積作答 <b class="num">' + ta + '</b> 次，正確率 <b class="num">' + (ta ? Math.round(tc * 100 / ta) : 0) + '%</b></div>'
    + (next ? '<div class="msum-next">下一站推薦：<b>' + esc(tShort(next.t).name) + '</b></div>' : '') + '</div>' + paco('study', 'msum-paco') + '</div>';
  // 站牌：之字形路線
  h += '<div class="trail">';
  st.forEach(function (s, i) {
    var sh = tShort(s.t), lv = s.seen === 0 ? 0 : (s.cov >= 0.8 && s.acc >= 0.8 ? 3 : (s.cov >= 0.4 ? 2 : 1));
    var tag = ['未出發', '探索中', '熟練中', '已精通'][lv];
    h += '<div class="stop ' + (i % 2 ? 'r' : 'l') + ' lv' + lv + (s === next ? ' next' : '') + '">'
      + '<button class="stop-node" data-act="mapGo" data-id="' + id + '" data-t="' + esc(s.t) + '" style="--p:' + Math.round(s.cov * 100) + '" title="從這一站出發練 20 題"><span class="num">' + esc(sh.no || String(i + 1)) + '</span></button>'
      + '<button class="stop-card" data-act="mapGo" data-id="' + id + '" data-t="' + esc(s.t) + '"><b>' + esc(sh.name) + '</b>'
      + '<span class="stop-meta num">練過 ' + s.seen + '／' + s.n + ' 題' + (s.a ? '・正確率 ' + Math.round(s.acc * 100) + '%' : '') + '</span>'
      + '<span class="stop-bar"><i style="width:' + Math.round(s.cov * 100) + '%"></i></span><span class="stop-tag">' + tag + '</span></button>'
      + (s === next ? paco('wave', 'stop-paco') : '') + '</div>';
  });
  h += '<div class="trail-end">🏁 終點：' + esc(e.name) + ' 合格！</div></div>';
  // 歷屆試卷集章
  var ps = papersOf(id).slice().sort(function (a, b) { return (a.sess || 0) - (b.sess || 0); });
  if (ps.length) {
    var doneN = ps.filter(function (p) { return plog[p.id]; }).length;
    h += '<div class="tstats"><h3>📮 歷屆試卷集章　<span class="num">' + doneN + '／' + ps.length + '</span></h3><p class="sc-cap">完成一份歷屆試卷就蓋上一枚郵戳，郵戳上是你的最佳成績。點選可直接作答。</p><div class="stamps">'
      + ps.map(function (p) {
        var x = plog[p.id], ok = x && x.b >= e.pass;
        return '<button class="stampx' + (x ? (ok ? ' got' : ' tried') : '') + '" data-act="startPaper" data-paper="' + esc(p.id) + '" title="' + esc(p.label) + (x ? '｜最佳 ' + x.b + ' 分、作答 ' + x.n + ' 次' : '｜尚未作答') + '">'
          + '<span class="sx-no">第 ' + (p.sess || '') + ' 期</span>' + (x ? '<span class="sx-sc num">' + x.b + '</span>' : '<span class="sx-q">?</span>') + '</button>';
      }).join('') + '</div></div>';
  }
  // 成就徽章
  var mocks = his.filter(function (r) { return r.examId === id && r.mode === 'mock'; });
  var badges = [
    ['🌱', '踏出第一步', '完成第一次作答', tseen > 0],
    ['📚', '百題達人', '練過 100 題', tseen >= 100],
    ['🏃', '五百題馬拉松', '練過 500 題', tseen >= 500],
    ['🗺️', '全圖踏查', '每個分類都練過', st.length && st.every(function (s) { return s.seen > 0; })],
    ['🎯', '首次及格', '模擬考達及格分', mocks.some(function (r) { return r.pass; })],
    ['📮', '集章新手', '完成 5 份歷屆試卷', ps.filter(function (p) { return plog[p.id]; }).length >= 5],
    ['🏆', '精通大師', '所有分類都「已精通」', st.length && st.every(function (s) { return s.cov >= 0.8 && s.acc >= 0.8; })]
  ];
  h += '<div class="tstats"><h3>🏅 成就徽章　<span class="num">' + badges.filter(function (b) { return b[3]; }).length + '／' + badges.length + '</span></h3><div class="badges">'
    + badges.map(function (b) { return '<div class="badge' + (b[3] ? ' got' : '') + '"><span class="bi">' + (b[3] ? b[0] : '🔒') + '</span><b>' + b[1] + '</b><i>' + b[2] + '</i></div>'; }).join('')
    + '</div>' + pacoSay('coin', '每拿到一枚徽章，Paco 就多一枚金幣！繼續加油～', 'badge-say') + '</div>';
  setHTML(h); setView('map', { id: id });
}

/* ================= 導航列／標記覆蓋層 ================= */
var NAVS = [
  { v: 'marks', act: 'navMarks', ico: ICON.star, label: '收藏', badge: 'navMk' },
  { v: 'wrongs', act: 'navWrong', ico: ICON.wrong, label: '錯題', badge: 'navWr' },
  { v: 'home', act: 'navHome', ico: '', label: '首頁', home: true },
  { v: 'flags', act: 'navFlags', ico: ICON.flag, label: '標記', badge: 'navFl' },
  { v: 'map', act: 'navMap', ico: ICON.map, label: '學習地圖' }
];
function buildChrome() {
  var nav = document.createElement('nav'); nav.id = 'bnav'; nav.setAttribute('aria-label', '主要功能');
  nav.innerHTML = NAVS.map(function (n) {
    return '<button class="nv' + (n.home ? ' nv-home' : '') + '" data-act="' + n.act + '" data-v="' + n.v + '"><span class="nv-ico">' + (n.home ? PACO_HEAD : n.ico)
      + (n.badge ? '<span class="nv-b" id="' + n.badge + '"></span>' : '') + '</span><span class="nv-t">' + n.label + '</span></button>';
  }).join('');
  document.body.appendChild(nav);
  var acct = document.createElement('div'); acct.id = 'acct'; acct.hidden = true; document.body.appendChild(acct);
  var ov = document.createElement('div'); ov.id = 'movl'; ov.className = 'movl'; ov.hidden = true;
  ov.innerHTML = '<div class="movl-box"><div class="movl-head"><b id="movlTitle"></b><span class="sp"></span><button class="btn btn-ghost btn-sm" data-act="closeFlags">關閉 ✕</button></div><div id="movlBody"></div></div>';
  document.body.appendChild(ov);
}
function activeWrongAll() { return getWrong().filter(function (x) { return (!x.r || x.w > x.r) && rawById(x.id); }); }
function curFlags(src) { src = src || S; var a = []; if (src && src.qs) src.qs.forEach(function (q, i) { if (src.flags[i]) a.push(i); }); return a; }
/* 標記的來源：目前（含已交卷、尚未回首頁）的測驗，否則為暫存中未完成的測驗；回到首頁後已完成測驗的標記即清除 */
function flagSrc() { return (S && S.qs) ? S : store.get(KEY.ses, null); }
function updateFab() {
  function put(id, n) { var el = document.getElementById(id); if (el) { el.textContent = n > 999 ? '999+' : (n || ''); el.classList.toggle('on', n > 0); } }
  put('navMk', getMarks().length); put('navWr', activeWrongAll().length); put('navFl', curFlags(flagSrc()).length);
  var top = { home: 'home', marks: 'marks', wrongs: 'wrongs', flags: 'flags', scores: 'map', hisd: 'map', map: 'map' }[curView] || '';
  document.querySelectorAll('#bnav .nv').forEach(function (b) { b.classList.toggle('on', b.dataset.v === top); });
}
function openFlags() {
  var fl = curFlags(), body = document.getElementById('movlBody'), h;
  document.getElementById('movlTitle').textContent = '🚩 標記（待檢查）' + (fl.length ? '　' + fl.length + ' 題' : '');
  if (!fl.length) h = '<div class="mempty">' + pacoSay('study', '目前沒有標記的題目。作答時按題目右上角的「🚩 標記」（或鍵盤 F），題目就會列在這裡，交卷前可以一次複查、直接作答。', 'empty-say') + '</div>';
  else h = '<div class="mhint">本次共標記 ' + fl.length + ' 題，可以直接在這裡作答' + (S.mode === 'mock' && !S.done ? '（交卷前不顯示正確答案）' : '') + '。</div>' + flagCards(S, true);
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
    fb.db.collection('users').doc(fb.user.uid).set({ history: store.get(KEY.his, []), marks: getMarks(), wrong: getWrong(), seen: getSeen(), papers: getPaperLog(), updatedAt: Date.now() }).catch(function () {});
  }, 1500);
}
function cloudPull() {
  fb.db.collection('users').doc(fb.user.uid).get().then(function (doc) {
    var c = doc.exists ? doc.data() : {};
    var his = mergeBy('ts', store.get(KEY.his, []), c.history); his.sort(function (a, b) { return b.ts - a.ts; });
    store.set(KEY.his, his.slice(0, HIS_MAX));
    store.set(KEY.marks, mergeBy('id', getMarks(), c.marks));
    mergeWrong(c.wrong); if (c.seen) mergeSeen(c.seen); if (c.papers) mergePapers(c.papers); updateFab(); scheduleSync();
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
  navHome: function () { guardLeave(vHome); },
  navMarks: function () { guardLeave(function () { vMarks(''); }); },
  navWrong: function () { guardLeave(function () { vWrongAll(); }); },
  navFlags: function () { if (curView === 'exam' && S && !S.done) return openFlags(); vFlags(); },
  navScores: function () { vScores(curArgs.id); },
  navMap: function () { guardLeave(function () { vMap(); }); },
  leaveYes: function () { closeModal(); clearInterval(timerId); timerId = null; var f = pendingLeave; pendingLeave = null; S = null; if (f) f(); },
  examBack: function () { var fr = S && S.from; guardLeave(function () { goFrom(fr); }); },
  scTab: function (d) { vScores(d.id, curView === 'scores' ? curArgs.f : ''); },
  scF: function (d) { vScores(curArgs.id, d.f); },
  wrTab: function (d) { vWrongAll(d.id, ''); },
  wrT: function (d) { vWrongAll(curArgs.f, d.t || ''); },
  wrMore: function () { wrongShow += 30; vWrongAll(curArgs.f, curArgs.t, true); },
  wrPractice: function (d) {
    var list = activeWrongAll().filter(function (x) { return x.exam === d.id; }).map(function (x) { return rawById(x.id); })
      .filter(function (q) { return q && (!d.t || q.topic === d.t); });
    if (list.length) makeSession(d.id, 'practice', pickN(list).map(function (q) { return toItem(q); }), { type: 'wrong', wrongScope: 'all' });
  },
  mapTab: function (d) { vMap(d.id); },
  setPN: function (d, t) { practN = +d.n; seg('#segPN', t); },
  mapGo: function (d) {
    var seen = getSeen(), pool = dedup(bankOf(d.id).filter(function (q) { return q.topic === d.t; }));
    if (!pool.length) return;
    var fresh = shuffle(pool.filter(function (q) { return !seen[q.id]; })), done = shuffle(pool.filter(function (q) { return seen[q.id]; }));
    var qs = fresh.concat(done).slice(0, 20).map(function (q) { return toItem(q); });
    makeSession(d.id, 'practice', qs, { type: 'map', mapTopic: d.t, label: tShort(d.t).name });
  },
  mkF: function (d) { vMarks(d.f || ''); },

  startMock: function (d) {
    var e = examById(d.id), qs = drawBalanced(d.id, e.qn);
    if (!qs.length) return;
    makeSession(d.id, 'mock', qs, { type: 'balanced' });
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
    var qs = paperQs(p).map(function (q) { return toItem(q, true); });
    if (!qs.length) return;
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
    var qs = pickN(list).map(function (m) { return toItem(markRaw(m)); });
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
    if (S.type === 'map') return ACT.mapGo({ id: S.examId, t: S.mapTopic });
    if (S.mode === 'mock') return ACT.startMock({ id: S.examId });
    var pool = dedup(bankOf(S.examId));
    makeSession(S.examId, 'practice', drawQuestions(e, Math.min(S.total, pool.length), {}), {});
  },
  resume: function () {
    var sv = store.get(KEY.ses, null); if (!sv) return vHome();
    S = sv;
    if (S.mode === 'mock' && Date.now() >= S.deadline) submit(true); else vExam();
  },
  abandon: function () { store.del(KEY.ses); vHome(); },
  clearAllAsk: function () {
    var n = store.get(KEY.his, []).length, m = getMarks().length, w = activeWrongAll().length, fl = curFlags(flagSrc()).length;
    openModal('確定要清除所有作答紀錄嗎？', '<p>以下資料會<b>全部刪除</b>，而且<b>無法復原</b>：</p><ul class="clr-list">'
      + '<li>歷史作答紀錄與成績單（' + n + ' 筆）</li><li>錯題本（' + w + ' 題）</li><li>收藏（' + m + ' 題）</li><li>標記（' + fl + ' 題，含未完成的測驗進度）</li><li>學習地圖的練習足跡與試卷集章</li></ul>'
      + (fb.user ? '<p>你已登入 Google，<b>雲端同步的資料也會一併清除</b>。</p>' : ''),
      '<button class="btn btn-ghost" data-act="modalClose">取消</button><button class="btn btn-danger" data-act="clearAll">確定全部清除</button>');
  },
  clearAll: function () {
    closeModal();
    [KEY.his, KEY.wrong, KEY.marks, KEY.ses].forEach(function (k) { store.del(k); });
    store.set(KEY.seen, {}); store.set(KEY.papers, {});
    S = null; scheduleSync();
    if (curView === 'scores') vScores(curArgs.id); else vHome();
  },

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
  closeFlags: function () { document.getElementById('movl').hidden = true; if (curView === 'exam' && S && !S.done) vExam(); },
  flagPick: function (d) {
    var src = flagSrc(); if (!src || src.done) return;
    if (src.mode === 'mock' && Date.now() >= src.deadline) { if (src !== S) S = src; return submit(true); }
    var i = +d.q, o = +d.o;
    if (src.mode === 'practice') { if (src.shown[i]) return; src.picked[i] = o; src.shown[i] = true; }
    else src.picked[i] = src.picked[i] === o ? null : o;
    if (src === S) saveSession(); else store.set(KEY.ses, src);
    refreshFlags();
  },
  flagOff: function (d) {
    var src = flagSrc(); if (!src || src.done) return;
    src.flags[+d.q] = false;
    if (src === S) saveSession(); else store.set(KEY.ses, src);
    refreshFlags();
  },
  flagJump: function (d) { document.getElementById('movl').hidden = true; S.idx = +d.i; sheetOpen = false; saveSession(); vExam(); },

  modalClose: function () { closeModal(); },
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
/* 手機：往下捲動時收起導航列，往上滑才出現 */
var lastY = 0, touchY = null;
function navShow(on) { document.body.classList.toggle('nav-hidden', !on); }
window.addEventListener('scroll', function () {
  var y = window.scrollY || 0;
  if (window.innerWidth > 900) { navShow(true); lastY = y; return; }
  if (y < lastY - 6) navShow(true);
  else if (y > lastY + 6 && y > 30) navShow(false);
  lastY = y;
}, { passive: true });
window.addEventListener('touchstart', function (e) { touchY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchmove', function (e) { if (touchY != null && e.touches[0].clientY - touchY > 40 && (window.scrollY || 0) < 10) navShow(true); }, { passive: true });
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
