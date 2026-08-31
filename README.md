# 黑白棋平衡道場

純前端黑白棋逐手教學。黑方與白方都由使用者操作；每一步不是只顯示答案，而是依序學習：

1. 讀空格連通區，不被目前棋子數誤導。
2. 比較翻子數與落子後的對手行動力，縮小候選。
3. 找孤立單格、雙方共用的節奏格，以及開角代價。
4. 顯示所有合法手的完整搜尋結果，證明哪些路線能維持和局。

選錯時保留盤面並說明為何必敗，使用者可重試；選對後換另一方繼續逐手學習，直到終局。

題目同時提供兩種入口：引導課程依序解鎖，自由練習可選任何一題。完成終局後以穩定盤面 ID 記錄成功時間、完成次數與步數；擴增或重排題庫不會讓既有進度錯位。

## 學習系統

- 「今日」依到期錯題、薄弱棋理與新題自動產生 3～10 題計畫。
- 「課程」呈現棋理分布與引導進度；「練習」保留黑白雙方都由使用者走的完整路徑。
- 「進度」不是單純答對率：提示程度、關鍵局面、獨立成功與跨題成功都會影響熟練度。
- 每次互動保存為只追加事件，投影資料可隨時重建；舊版 `localStorage` 完成紀錄會自動遷移。
- 訪客／離線模式始終可用；正式站已接上 Supabase，使用者可自行選擇 Google 登入與跨裝置同步。帳號頁也可匯出 JSON。

## 資料範圍

- 從完整 17,104 個已證明和局的 e20 起點，依棋理、難度、解答數與計算需求選出 100 題
- 430,695 個盤面節點、449,920 條關係
- 170,072 條平衡關係、273,566 條失敗關係、6,282 條 pass 關係
- 20 個二進位分片，共 20.01 MiB；每片載入時驗證 SHA-256
- 59 題唯一平衡解、41 題多重平衡解；46 題的棋理首選仍須用完整搜尋修正
- 目前資料保存的是「可維持和局／無失誤下必敗」類別，沒有虛構未保存的最終子差

## 載入策略

啟動時只下載約 108 KiB 的題目目錄，再依目前題目載入所屬分片（約 1 MiB）。同一分片的題目共用資料且只載入一次；Service Worker 會把使用過的分片留作離線練習，不會在首次開站預載全部 20.01 MiB。

重新產生 100 題版本：

```powershell
npm.cmd run build:release100
```

若系統沒有可用的 npm 啟動器，也可直接執行：

```powershell
node tools/build-curriculum-release.mjs --source ../../data/e20-balanced/v1 --lessons 100 --max-shards 20
```

## 本機驗證

```powershell
npm.cmd start
npm.cmd test
npm.cmd run audit:data
```

開啟 `http://127.0.0.1:4173/`。請使用 HTTP，不要直接用 `file://`，因為資料驗證與 Service Worker 需要瀏覽器安全環境。

## 架構

頁面只載入靜態 HTML、CSS、JavaScript 與預先精算的 DAG 資料，不需要執行中的求解器。Service Worker 提供離線快取，IndexedDB 保存 append-only 學習事件、同步 outbox 與可重建投影。題庫分片與個人資料分離：瀏覽器只按當前題目下載約 1 MiB 分片。

跨裝置功能採可插拔架構。`config.js` 只含可公開的 Supabase URL 與 publishable key；Google Client Secret 與 Supabase Service Role Key 不會進入前端或 Git。Google OAuth、Supabase RLS 與部署驗收方式見 [docs/AUTH_AND_SYNC_SETUP.md](docs/AUTH_AND_SYNC_SETUP.md)。
