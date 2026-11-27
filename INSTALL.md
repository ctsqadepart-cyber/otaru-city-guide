# 安裝與部署

## Windows 一鍵啟動

1. 解壓縮整個專案 ZIP，進入 `otaru-canal` 資料夾。
2. 確認電腦已安裝 [Node.js](https://nodejs.org/) 22 或更新版本，再雙擊 `啟動網站.cmd`。
3. 網站會在預設瀏覽器開啟。使用時保留命令視窗。若瀏覽器未自動開啟，在網址列貼上命令視窗顯示的 `http://127.0.0.1:…/` 網址。

網址列若顯示 `file://`，代表瀏覽器直接開啟了 HTML 檔案。以啟動器或下方的指令啟動網站，即可載入互動功能。

## 從終端機開啟

1. 解壓縮專案 ZIP，在 `otaru-canal` 資料夾開啟終端機。
2. 安裝 [Node.js](https://nodejs.org/) 22 或更新版本，執行以下指令。

   ```bash
   npm run check
   npm start
   ```

3. 用瀏覽器開啟 [http://127.0.0.1:5173](http://127.0.0.1:5173)。按 Ctrl+C 停止伺服器。

如果 5173 已被使用，可以在 PowerShell 執行 `$env:PORT='8080'; npm start`，或在 macOS／Linux 執行 `PORT=8080 npm start`。瀏覽器網址同步改成 [http://127.0.0.1:8080](http://127.0.0.1:8080)。

有 Python 3 的電腦也可在同一資料夾執行下列指令，並開啟 [http://127.0.0.1:8000](http://127.0.0.1:8000)。

```bash
python -m http.server 8000 --bind 127.0.0.1
```

請透過 HTTP 伺服器開啟，讓瀏覽器能載入 ES 模組及 JSON。建議使用支援 WebGL 2 與 Import Maps 的近期版 Chrome、Edge、Firefox 或 Safari。照片、平面地圖和路線可在關閉 WebGL 的裝置使用。

## 部署至 GitHub Pages

1. 在 GitHub 建立儲存庫。使用 GitHub Free 時可用公開儲存庫。
2. 將 `otaru-canal` 資料夾**裡的內容**放在儲存庫根目錄，包含 `.github/workflows/pages.yml` 和 `.nojekyll`。可用下列指令替換範例網址後上傳到新建立的空儲存庫。

   ```bash
   git init -b main
   git add --all
   git commit -m "建立小樽全區互動旅遊網站"
   git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPO.git
   git push -u origin main
   ```

3. 在儲存庫設定開啟 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。
4. 到 **Actions**，選 **部署小樽全區導覽至 GitHub Pages**，執行 **Run workflow**。之後推送 `main` 分支會重新部署。若儲存庫使用其他主分支，請同步調整工作流程的 `branches`。
5. 工作流程完成後，在 **Settings → Pages** 取得公開網址。一般專案網址為 `https://YOUR-ACCOUNT.github.io/YOUR-REPO/`。

工作流程會驗證資料和程式，再上傳 `index.html`、`src/`、`data/`、`assets/` 和 `.nojekyll`。所有網站路徑都相對於專案根目錄，無須設定網站子路徑。持續部署及權限設定可參考 [GitHub 官方說明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 選用：更新全市圖資

在專案根目錄執行以下指令。第一個指令從 OpenStreetMap 擷取廣域向量資料及八份景點周邊快照，存到 `map-sources/`。第二個指令將資料分成 `data/map.json` 與 `data/structures.json`。請將日期改成當日實際擷取日期。

```bash
node scripts/fetch_city_map.mjs
python -B scripts/prepare_city_map.py --overview map-sources/overview.json --source-dir map-sources --date YYYY-MM-DD
npm run check
```

原始快照可以保留供校對。地圖和建物更新後，請在全區及任一分區各開一次 3D 地圖，確認海岸和景點標記。若上游更改海岸線識別碼，更新工具會指出需核對的資料。
