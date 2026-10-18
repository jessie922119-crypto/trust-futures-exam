/* Firebase 設定（Google 登入＋雲端同步）
 * 1. 到 https://console.firebase.google.com 建立專案 → 新增「網頁應用程式」
 * 2. 把 Firebase 顯示的 firebaseConfig 內容貼到下方（apiKey 留空＝不啟用登入，只用本機儲存）
 * 這組設定是公開的前端識別碼，不是密碼；資料安全由 firestore.rules 控管。
 */
window.__FIREBASE__ = {
  apiKey: "AIzaSyALrFKxFkPSvSduUPUd8SmPgnC_bsJUvW4",
  authDomain: "trust-futures-exam.firebaseapp.com",
  projectId: "trust-futures-exam",
  storageBucket: "trust-futures-exam.firebasestorage.app",
  messagingSenderId: "967353247284",
  appId: "1:967353247284:web:47029688aedd2446e84c61"
};
