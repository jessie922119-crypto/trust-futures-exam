# 信託・期貨證照模擬測驗系統

信託業業務人員信託業務專業測驗（信託法規、信託實務）與期貨商業務員資格測驗（期貨交易法規、期貨交易理論與實務）的線上模擬考與題庫練習網站。純前端靜態網站，可直接部署在 GitHub Pages；登入 Google 後以 Firebase 雲端同步作答紀錄。

## 功能

- 模擬考：依正式題數與時間隨機抽題、倒數計時、時間到自動交卷，可選題目來源（全部／官方歷屆／書籍題庫）
- 自訂練習：選題數、順序、主題；每題作答後立即顯示逐選項解析
- 歷屆整份試卷、書籍題庫依章節練習、依章節比例隨機抽題
- 題庫瀏覽（主題篩選、分頁）
- 錯題重練（最近 1／3／5 次、累積錯題，答對自動移除）
- 🚩 標記待檢查、⭐ 永久收藏（含收藏題練習）
- 成績單、各主題答對率、錯題檢討、作答紀錄回看
- 進度暫存可續考、鍵盤快捷鍵（1–4／A–D、←→、F）、手機版答題卡
- 匯出／匯入備份檔、Google 登入雲端同步

## 檔案結構

```
index.html            頁面殼
assets/style.css      樣式（藍色系）
assets/app.js         主程式
data/meta.js          考試規則設定（題數、時間、及格標準）
data/bank.js          題庫（目前為示範題）
data/papers.js        歷屆整份試卷（目前為示範卷）
firebase-config.js    Firebase 設定（留空＝不啟用登入）
firestore.rules       Firestore 安全規則
tools/convert_bank.py 題庫轉檔工具（Excel／CSV → data/*.js）
tools/*範本.csv        題庫欄位範本
docs/簡章/            官方電腦應試簡章 PDF
```

## 更新題庫

1. 依 `tools/題庫範本.csv`（練習題庫）或 `tools/歷屆試卷範本.csv`（整份試卷）的欄位整理 Excel 或 CSV
2. 執行轉檔（可一次給多個檔案；加 `--check` 只檢查不寫入）：

```bash
python3 tools/convert_bank.py 題庫/*.xlsx
```

```bash
python3 tools/convert_bank.py --papers 題庫/歷屆/*.xlsx
```

題號請保持固定，收藏、錯題本與作答紀錄都靠題號對應。

## 本機預覽

```bash
python3 -m http.server 8765
```

開啟 http://localhost:8765/

## 部署到 GitHub Pages

1. 在 GitHub 建立新的 repository（例如 `trust-futures-exam`），把本資料夾推上去
2. Repository → Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`／`/(root)`
3. 網址為 `https://<你的帳號>.github.io/<repository 名稱>/`

## 設定 Google 登入（Firebase）

1. 到 [Firebase Console](https://console.firebase.google.com) 建立專案
2. 專案設定 → 一般 → 新增「網頁應用程式」，把顯示的 `firebaseConfig` 貼進 `firebase-config.js`
3. Authentication → Sign-in method → 啟用 **Google**
4. Authentication → Settings → 授權網域 → 新增 `<你的帳號>.github.io`（本機測試另加 `localhost`）
5. Firestore Database → 建立資料庫（正式模式）→ 規則分頁貼上 `firestore.rules` 內容並發布

資料存在 Firestore `users/{uid}`，每位使用者只能讀寫自己的資料。

## 考試規則來源

- 信託：台灣金融研訓院《信託業業務人員信託業務專業測驗 電腦應試說明》（114/6/1 起適用，2026-04-15 版）
- 期貨：證基會《專業科目測驗 電腦應試說明及操作手冊》（115.09.01 版）
