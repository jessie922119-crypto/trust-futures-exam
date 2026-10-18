#!/usr/bin/env python3
"""解析金研院「信託業業務人員信託業務專業測驗」歷屆試題（已轉成 .md），配對官方答案。

用法：python3 tools/parse_trust_md.py 信託考古題            → 產生 data/bank-trust.js
      python3 tools/parse_trust_md.py 信託考古題 檢查.json  → 只輸出解析結果供檢查
資料夾結構：每期一個子資料夾（41、42…），內含 3 個 .md：法規試題、實務試題、答案。
檔案角色依內容判斷（不依檔名）：含「試題正確答案」者為答案；標題含「科目：信託法規」「科目：信託實務」者為試題。
"""
import json
import os
import re
import sys

PAGE = re.compile(r'^\s*(<!--.*?-->|---+)\s*$')
CJK = r'[　-〿㐀-鿿＀-￯]'


def clean(s):
    s = re.sub(r'\s+', ' ', s).strip()
    # 去掉中文字之間因換行／排版產生的空白
    s = re.sub(r'(?<=%s) (?=%s)' % (CJK, CJK), '', s)
    s = re.sub(r'(?<=%s) (?=[\w(（])' % CJK, '', s)
    s = re.sub(r'(?<=[\w)）]) (?=%s)' % CJK, '', s)
    return s


def role_of(text):
    head = text[:1500]
    if '試題正確答案' in head or '正確答案' in head[:600]:
        return 'ans'
    if re.search(r'科目：\s*信託法規', head):
        return 'law'
    if re.search(r'科目：\s*信託實務', head):
        return 'prac'
    return None


def parse_answers(text):
    t = text.replace(' ', '')
    out = {}
    parts = re.split(r'科目：', t)
    for p in parts[1:]:
        key = 'law' if p.startswith('信託法規') else ('prac' if p.startswith('信託實務') else None)
        if not key:
            continue
        out[key] = {int(n): a for n, a in re.findall(r'(\d{1,2})\.【([^】]*)】', p)}
    return out


def parse_questions(text, expected):
    lines = [l for l in text.splitlines() if not PAGE.match(l)]
    qs, cur, n = {}, None, 0
    for line in lines:
        # 題號後通常是「.」，少數漏打（如「22 有關…」），只接受下一個連續題號
        m = re.match(r'^\s*(\d{1,2})\s*(?:[\.．、]|\s+(?=[一-鿿「（(]))\s*(.*)$', line)
        if m and int(m.group(1)) == n + 1:
            n += 1
            cur = qs[n] = [m.group(2)]
            continue
        if cur is not None:
            cur.append(line)
    out, problems = {}, []
    for k, body in qs.items():
        raw = '\n'.join(body)
        # 依序尋找 (1)(2)(3)(4) 選項標記
        pos, start = [], 0
        for i in range(1, 5):
            m = re.compile(r'[\(（]\s*%d\s*[\)）]' % i).search(raw, start)
            if not m:
                break
            pos.append((m.start(), m.end()))
            start = m.end()
        if len(pos) != 4:
            problems.append((k, '找不到 4 個選項', clean(raw)[:80]))
            continue
        stem = clean(raw[:pos[0][0]])
        opts = [clean(raw[pos[i][1]:(pos[i + 1][0] if i < 3 else len(raw))]) for i in range(4)]
        # 最後一題後面可能接到試卷結尾文字
        opts[3] = re.split(r'\s*(以下空白|【背面尚有試題】|試題結束)', opts[3])[0].strip()
        if not stem or not all(opts):
            problems.append((k, '題幹或選項為空', stem[:60]))
        out[k] = {'q': stem, 'options': opts}
    missing = [i for i in range(1, expected + 1) if i not in out]
    return out, problems, missing


SUBJ = {'law': ('trust-law', '信託法規', 'TL'), 'prac': ('trust-prac', '信託實務', 'TP')}


ANN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'annotations')


def norm_key(q, opts):
    return re.sub(r'\s', '', q)[:60] + '|' + re.sub(r'\s', '', '|'.join(opts))


def load_annotations():
    """讀取 tools/annotations/*.tsv（題號、主題代碼、解析、?＝細節待查證）與 topics.json。"""
    topics = json.load(open(os.path.join(ANN_DIR, 'topics.json'), encoding='utf-8'))
    ann = {}
    for f in sorted(os.listdir(ANN_DIR)):
        if f.endswith('.tsv'):
            for line in open(os.path.join(ANN_DIR, f), encoding='utf-8'):
                p = line.rstrip('\n').split('\t')
                if len(p) >= 3:
                    ann[p[0]] = {'code': p[1], 'note': p[2], 'nv': len(p) > 3 and p[3] == '?'}
    return topics, ann


def emit_js(papers, dst):
    """產生 data/bank-trust.js：題庫（官方歷屆題）＋整份歷屆試卷（以題號引用題庫，不重複存題目）。"""
    bank, plist = {'trust-law': [], 'trust-prac': []}, []
    topics, ann = load_annotations()
    # 解析只寫在每組重複題的其中一題，依題目內容套用到所有重複題
    by_key, all_q = {}, []
    for p in papers:
        _, _, pre = SUBJ[p['subject']]
        for q in p['questions']:
            qid = '%s-OF-%02d-%02d' % (pre, p['period'], q['no'])
            all_q.append((qid, norm_key(q['q'], q['options'])))
            if qid in ann:
                by_key[norm_key(q['q'], q['options'])] = ann[qid]
    missing = [qid for qid, k in all_q if k not in by_key]
    if missing:
        print('⚠️  尚無解析與主題的題目 %d 題（將以期別為主題）：%s' % (len(missing), ', '.join(missing[:10])))
    for p in sorted(papers, key=lambda x: (-x['period'], x['subject'])):
        exam, name, pre = SUBJ[p['subject']]
        per, ids = p['period'], []
        for q in p['questions']:
            if q['answer'] is None:
                continue
            qid = '%s-OF-%02d-%02d' % (pre, per, q['no'])
            ids.append(qid)
            a = by_key.get(norm_key(q['q'], q['options']))
            item = {
                'id': qid, 'exam': exam, 'subject': '',
                'topic': topics[exam][a['code']] if a else '官方歷屆 ─ 第 %d 期' % per, 'kind': 'off',
                'difficulty': 2, 'q': q['q'], 'options': q['options'], 'answer': q['answer'],
                'explain': ['', '', '', ''], 'note': a['note'] if a else '',
                'src': '第 %d 期信託業業務人員信託業務專業測驗｜%s 第 %d 題（金研院公布之試題與正確答案）' % (per, name, q['no'])}
            if a and a['nv']:
                item['nv'] = 1
            bank[exam].append(item)
        plist.append({'id': '%s-p%d' % (exam, per), 'exam': exam, 'examName': name, 'era': '信託業務專業測驗',
                      'sess': per, 'label': '第 %d 期' % per, 'qn': len(ids), 'qids': ids})
    # 依測驗範圍主題順序排列（同主題內依期別、題號），題庫瀏覽與自訂練習的主題即依此順序呈現
    for k in bank:
        order = {v: i for i, v in enumerate(topics[k].values())}
        bank[k].sort(key=lambda x: (order.get(x['topic'], 99), x['id']))
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/parse_trust_md.py 產生（來源：信託考古題/*.md），請勿手動編輯 */\n')
        f.write('(function (B, P) {\n')
        for k, v in bank.items():
            f.write('B[%s] = %s;\n' % (json.dumps(k), json.dumps(v, ensure_ascii=False, separators=(',', ':'))))
        f.write('P.push.apply(P, %s);\n' % json.dumps(plist, ensure_ascii=False, separators=(',', ':')))
        f.write('})(window.__BANK__ = window.__BANK__ || {}, window.__PAPERS__ = window.__PAPERS__ || []);\n')
    print('已寫入 %s：信託法規 %d 題、信託實務 %d 題、試卷 %d 份' % (dst, len(bank['trust-law']), len(bank['trust-prac']), len(plist)))


def main(root, dst):
    papers, report = [], []
    for d in sorted(os.listdir(root), key=lambda x: (not x.isdigit(), x.zfill(4))):
        p = os.path.join(root, d)
        if not os.path.isdir(p):
            continue
        files = {}
        for f in sorted(os.listdir(p)):
            if f.endswith('.md'):
                t = open(os.path.join(p, f), encoding='utf-8').read()
                r = role_of(t)
                if r:
                    files[r] = t
        if set(files) != {'ans', 'law', 'prac'}:
            report.append('第 %s 期：檔案不齊全（找到 %s）' % (d, sorted(files)))
            continue
        ans = parse_answers(files['ans'])
        for key, expected in (('law', 50), ('prac', 80)):
            qs, problems, missing = parse_questions(files[key], expected)
            a = ans.get(key, {})
            items = []
            for i in range(1, expected + 1):
                if i not in qs:
                    continue
                av = a.get(i, '')
                item = dict(no=i, **qs[i])
                if re.fullmatch(r'[1-4]', av):
                    item['answer'] = int(av) - 1
                else:
                    item['answer'] = None
                    item['ansRaw'] = av
                    problems.append((i, '答案非單一選項', av))
                items.append(item)
            report.append('第 %s 期 %s：題目 %d／%d，答案 %d，缺題 %s，問題 %d' % (
                d, '法規' if key == 'law' else '實務', len(qs), expected, len(a), missing or '無', len(problems)))
            for pr in problems:
                report.append('    ⚠️ 第 %s 題：%s ─ %s' % pr)
            papers.append({'period': int(d), 'subject': key, 'questions': items})
    print('\n'.join(report))
    if dst.endswith('.js'):
        emit_js(papers, dst)
    else:
        json.dump(papers, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'data/bank-trust.js')
