/* 只在本機提供網站公開檔案，方便測試 ES 模組及 JSON 載入。 */
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../',import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const openBrowser = process.argv.includes('--open') && process.platform === 'win32';
const contentTypes = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.webp':'image/webp'
};

const server = createServer(async (request,response) => {
  const respond = (status,message) => {
    response.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});
    response.end(request.method === 'HEAD' ? undefined : message);
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') return respond(405,'此方法無法使用');
  try {
    const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const name = path === '/' ? '/index.html' : path;
    if (!/^\/(index\.html$|assets\/|data\/|src\/)/.test(name)) return respond(404,'找不到檔案');
    const resolved = resolve(root,'.' + name);
    if (!resolved.startsWith(root + sep)) return respond(404,'找不到檔案');
    const info = await stat(resolved);
    if (!info.isFile()) return respond(404,'找不到檔案');
    response.writeHead(200,{'Content-Type':contentTypes[extname(resolved)] || 'application/octet-stream',
      'Content-Length':info.size,'X-Content-Type-Options':'nosniff'});
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(resolved);
      stream.on('error',error => response.destroy(error));
      stream.pipe(response);
    }
  } catch {
    if (!response.headersSent) respond(404,'找不到檔案');
    else response.destroy();
  }
});

// Windows 啟動器會開啟預設瀏覽器，並在預設連接埠已使用時自動挑選可用連接埠。
let pickedFallback = false;
server.on('error',error => {
  if (openBrowser && !pickedFallback && error.code === 'EADDRINUSE') {
    pickedFallback = true;
    server.listen(0,host);
    return;
  }
  console.error('無法啟動小樽運河預覽：' + error.message);
  process.exitCode = 1;
});
server.once('listening',() => {
  const url = 'http://' + host + ':' + server.address().port + '/';
  console.log('小樽運河預覽  ' + url);
  console.log('停止預覽請按 Ctrl+C。');
  if (openBrowser) {
    const browser = spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});
    browser.on('error',() => console.log('請手動在瀏覽器開啟 ' + url));
  }
});
server.listen(port,host);

