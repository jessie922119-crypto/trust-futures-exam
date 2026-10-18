/* 歷屆整份試卷（目前為示範卷；正式資料請用 tools/convert_bank.py --papers 轉出覆蓋）
 * 每份試卷：id、exam（科目代碼）、examName、yROC（民國年）、yCE（西元年）、sess（第幾次）、label、qn、questions[{q, options[4], answer, note}]
 */
window.__PAPERS__ = [
  { id: "fut-prac-demo-1", exam: "fut-prac", examName: "期貨交易理論與實務", yROC: 115, yCE: 2026, sess: 1, label: "示範卷（非官方）", qn: 3,
    questions: [
      { q: "賣出賣權（Sell Put）之最大獲利為下列何者？", options: ["無限大", "履約價格", "所收取之權利金", "標的物價格"], answer: 2, note: "賣方最大獲利即為收取之權利金。" },
      { q: "小型臺指期貨每點價值為新臺幣多少元？", options: ["50 元", "100 元", "200 元", "10 元"], answer: 0, note: "小型臺指期貨契約乘數為每點 50 元。" },
      { q: "持有現貨股票、擔心股價下跌者，應採取何種期貨避險？", options: ["買進期貨", "賣出期貨", "買進買權", "不需避險"], answer: 1, note: "持有現貨擔心下跌，應賣出期貨（空頭避險）。" }
    ] }
];
