# Google 登入與跨裝置同步設定

目前網站預設是完整可用的訪客模式。登入不是學習前置條件；沒有 Supabase 設定時，所有紀錄只存於瀏覽器 IndexedDB。

## 啟用方式

1. 建立 Supabase 專案，在 SQL Editor 執行 `supabase/migrations/202608310001_learning_platform.sql`。
2. 在 Supabase Authentication 啟用 Google provider，填入 Google Cloud OAuth client ID 與 secret。
3. 在 Google Cloud 與 Supabase URL Configuration 同時加入正式 GitHub Pages 網址及本機測試網址。
4. 將 `config.example.js` 複製為 `config.js`，填入 Supabase Project URL 與公開 anon key，並把 `sync.enabled` 設成 `true`。
5. 以兩個瀏覽器登入同一帳號，分別答題後按「立即同步」，確認事件合併且不重複。

`anonKey` 是設計成可公開於前端的專案識別金鑰；資料安全依賴資料表的 Row Level Security。不得把 `service_role` 金鑰、Google client secret 或任何私人密鑰放進網站或 GitHub。

## 同步邊界

- 上傳：小型、只追加的學習事件，如答題、提示與完成紀錄。
- 不上傳：20 MiB 精算棋譜分片；它們仍由 GitHub Pages 靜態提供並以 SHA-256 驗證。
- 衝突：以 `event_id` 去重，再由所有事件重建熟練度與複習排程。
- 失敗：本機資料不會因網路或登入失敗而刪除；未傳事件留在 outbox 等待下次同步。

## 正式發布前驗收

- Google OAuth consent screen、隱私網址與授權網域完成設定。
- 未登入、離線、登入、登出、跨裝置合併各測一次。
- 以兩個不同帳號驗證 RLS：帳號 A 不得查到帳號 B 的任何事件。
- 在 Supabase 設定資料保留、備份與刪除申請流程。
