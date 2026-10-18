#!/usr/bin/env python3
"""題庫轉檔：把 Excel（.xlsx）或 CSV 題庫轉成網站使用的 data/bank.js 或 data/papers.js。

用法
  題庫（練習／模擬考用）：
    python3 tools/convert_bank.py 題庫1.xlsx 題庫2.csv ...            → 輸出 data/bank.js
  歷屆整份試卷：
    python3 tools/convert_bank.py --papers 歷屆試卷.xlsx ...           → 輸出 data/papers.js
  只檢查不輸出：加 --check

欄位（第一列為標題，欄名需相同，順序不拘；見 tools/題庫範本.csv、tools/歷屆試卷範本.csv）
  題庫：科目代碼, 題號, 大分類, 主題, 類型, 難度, 題目, A, B, C, D, 答案, 解析A, 解析B, 解析C, 解析D, 整題解析, 出處
    科目代碼  trust-law（信託法規）／trust-prac（信託實務）／fut-law（期貨交易法規）／fut-prac（期貨交易理論與實務）
    類型      自編／官方／書籍（可留空，系統依內容自動判斷）
    答案      A～D 或 1～4
    題號      留空會自動編號（但之後更新題庫時題號會變，收藏與錯題本將對不上，建議自行給固定題號）
  歷屆試卷：科目代碼, 民國年, 次別, 題序, 題目, A, B, C, D, 答案, 解析
"""
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMS = {
    "trust-law": "信託法規",
    "trust-prac": "信託實務",
    "fut-law": "期貨交易法規",
    "fut-prac": "期貨交易理論與實務",
}
KIND = {"自編": "self", "官方": "off", "書籍": "book", "self": "self", "off": "off", "book": "book", "": ""}


def read_rows(path):
    if path.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        rows = []
        for ws in wb.worksheets:
            it = ws.iter_rows(values_only=True)
            head = next(it, None)
            if not head:
                continue
            head = [str(h or "").strip() for h in head]
            for r in it:
                if r and any(c not in (None, "") for c in r):
                    rows.append({head[i]: ("" if c is None else str(c).strip()) for i, c in enumerate(r) if i < len(head)})
        return rows
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(f)]


def parse_answer(v):
    v = str(v).strip().upper().replace("（", "").replace("）", "").replace("(", "").replace(")", "")
    if v in "ABCD" and len(v) == 1:
        return "ABCD".index(v)
    if v in ("1", "2", "3", "4"):
        return int(v) - 1
    raise ValueError("答案需為 A～D 或 1～4，收到：%r" % v)


def build_bank(paths):
    bank, errors, seen, auto = {k: [] for k in EXAMS}, [], set(), {}
    for p in paths:
        for n, r in enumerate(read_rows(p), start=2):
            where = "%s 第 %d 列" % (os.path.basename(p), n)
            try:
                exam = r.get("科目代碼", "")
                if exam not in EXAMS:
                    raise ValueError("科目代碼不正確：%r（可用：%s）" % (exam, "、".join(EXAMS)))
                opts = [r.get(k, "") for k in "ABCD"]
                if not r.get("題目") or not all(opts):
                    raise ValueError("題目或選項 A～D 有空白")
                qid = r.get("題號", "")
                if not qid:
                    auto[exam] = auto.get(exam, 0) + 1
                    qid = "%s-%04d" % (exam.upper(), auto[exam])
                if qid in seen:
                    raise ValueError("題號重複：%s" % qid)
                seen.add(qid)
                kind = KIND.get(r.get("類型", ""), None)
                if kind is None:
                    raise ValueError("類型需為 自編／官方／書籍 或留空")
                item = {
                    "id": qid, "exam": exam, "subject": r.get("大分類", ""), "topic": r.get("主題", "") or "綜合",
                    "difficulty": int(r.get("難度") or 2), "q": r["題目"], "options": opts,
                    "answer": parse_answer(r.get("答案", "")),
                    "explain": [r.get("解析" + k, "") for k in "ABCD"],
                    "note": r.get("整題解析", ""), "src": r.get("出處", ""),
                }
                if kind:
                    item["kind"] = kind
                bank[exam].append(item)
            except Exception as e:  # noqa: BLE001
                errors.append("%s：%s" % (where, e))
    return bank, errors


def build_papers(paths):
    papers, errors = {}, []
    for p in paths:
        for n, r in enumerate(read_rows(p), start=2):
            where = "%s 第 %d 列" % (os.path.basename(p), n)
            try:
                exam = r.get("科目代碼", "")
                if exam not in EXAMS:
                    raise ValueError("科目代碼不正確：%r" % exam)
                y, s = int(float(r["民國年"])), int(float(r["次別"]))
                opts = [r.get(k, "") for k in "ABCD"]
                if not r.get("題目") or not all(opts):
                    raise ValueError("題目或選項 A～D 有空白")
                pid = "%s-%d-%d" % (exam, y, s)
                pp = papers.setdefault(pid, {"id": pid, "exam": exam, "examName": EXAMS[exam], "yROC": y, "yCE": y + 1911,
                                             "sess": s, "label": "%d 年第 %d 次" % (y, s), "qs": []})
                pp["qs"].append((int(float(r.get("題序") or len(pp["qs"]) + 1)),
                                 {"q": r["題目"], "options": opts, "answer": parse_answer(r.get("答案", "")), "note": r.get("解析", "")}))
            except Exception as e:  # noqa: BLE001
                errors.append("%s：%s" % (where, e))
    out = []
    for pp in sorted(papers.values(), key=lambda x: (x["exam"], -x["yROC"], -x["sess"])):
        qs = [q for _, q in sorted(pp.pop("qs"), key=lambda t: t[0])]
        pp["qn"], pp["questions"] = len(qs), qs
        out.append(pp)
    return out, errors


def main(argv):
    papers_mode, check = "--papers" in argv, "--check" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 1
    if papers_mode:
        data, errors = build_papers(paths)
        target, var = os.path.join(ROOT, "data", "papers.js"), "__PAPERS__"
        summary = "%d 份試卷，共 %d 題" % (len(data), sum(p["qn"] for p in data))
    else:
        data, errors = build_bank(paths)
        target, var = os.path.join(ROOT, "data", "bank.js"), "__BANK__"
        summary = "、".join("%s %d 題" % (EXAMS[k], len(v)) for k, v in data.items())
    for e in errors:
        print("⚠️ ", e)
    print("讀取完成：", summary, "；錯誤 %d 筆" % len(errors))
    if errors or check:
        if errors:
            print("有錯誤，未寫入檔案。請修正後重跑。")
        return 1 if errors else 0
    with open(target, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/convert_bank.py 產生，請勿手動編輯 */\nwindow.%s = " % var)
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("已寫入", os.path.relpath(target, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
