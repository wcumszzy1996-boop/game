/**
 * scripts/build.mjs — 把整个游戏打包成"单文件 HTML"
 *
 * 为什么要打包：
 *   浏览器出于 CORS 限制，禁止通过 file:// 加载 ES Module（import）。
 *   把 src/*.js 与 vendor/three 一起 bundle 成 IIFE 内联进 HTML 后，
 *   产物可直接双击打开，也能被 Electron / Tauri / 微信 WebView 直接加载。
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

async function main() {
  await mkdir(DIST, { recursive: true });

  const result = await build({
    entryPoints: [path.join(ROOT, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    logLevel: 'info',
  });

  const code = result.outputFiles[0].text;
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');

  const tag = '<script type="module" src="./src/main.js"></script>';
  if (!html.includes(tag)) throw new Error('index.html 中找不到入口脚本标签，无法内联');

  // 必须用「函数替换」而不是字符串替换：压缩后的代码里含有 $& / $' / $` 这类
  // 序列，String.replace 的字符串形式会把它们当成替换模式（$& = 整个匹配），
  // 结果 bundle 被悄悄改坏。函数返回值不做任何 $ 解释。
  const out = html.replace(tag, () =>
    `<script>/* 星锋突击 STARSTRIKE — 单文件构建，包含 Three.js 与全部游戏逻辑 */\n${code}</script>`
  );

  if (out.includes(tag)) throw new Error('内联失败：入口脚本标签仍然存在');
  if (!out.includes(code.slice(0, 64))) throw new Error('内联失败：bundle 内容未写入');

  const outFile = path.join(DIST, 'starstrike.html');
  await writeFile(outFile, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
  console.log(`\n✓ 构建完成：${outFile}  (${kb} KB，单文件，可直接双击运行)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
