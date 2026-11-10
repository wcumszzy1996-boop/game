/**
 * scripts/package.mjs — 打包成独立桌面 APP
 *
 * 做法：先把运行期真正需要的文件「暂存」到一个干净的 build/stage 目录，
 * 再用 electron-packager 对暂存目录打包。这样产物里不会混进 src/、tools/、
 * node_modules/ 等开发文件，体积小且不会泄露源码。
 *
 * 用 spawn + 参数数组调用 CLI，避免 Windows cmd 对 `^` `|` 的转义问题。
 *
 * 用法：
 *   node scripts/package.mjs [--platform win32|darwin|linux] [--arch x64|arm64] [--out release]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PLATFORM = arg('platform', 'win32');
const ARCH = arg('arch', process.platform === 'darwin' ? 'arm64' : 'x64');
const OUTNAME = arg('out', 'dist-app');
const APPNAME = arg('name', 'StarStrike');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, 'build', 'stage');
const DIST_HTML = path.join(ROOT, 'dist', 'starstrike.html');

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} 退出码 ${code}`))));
  });

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/**
 * 清空一个目录，为重新打包让路。
 *
 * 为什么不能只用 rmSync：
 *   1) electron-packager 的 --overwrite 走 safe-delete → 系统回收站，
 *      某些 Windows 环境下会抛 "Error during a `trash` operation"（文件其实没被占用）；
 *   2) 部分安全加固的运行环境会劫持 Node 的 fs.rm*，把删除重定向到回收站，
 *      回收站不可用时连 rmSync 也会失败。
 * 所以这里先试 rmSync，失败就退化成"改名挪到一边"——不删数据，只是让目标路径空出来，
 * 打包流程照常进行。挪走的旧产物由用户自行清理。
 */
function clearOutDir(p) {
  if (!fs.existsSync(p)) return true;
  try {
    fs.rmSync(p, { recursive: true, force: true });
    if (!fs.existsSync(p)) return true;
  } catch { /* 交给下面的改名兜底 */ }
  try {
    const aside = `${p}.stale-${Date.now()}`;
    fs.renameSync(p, aside);
    console.log(`  ! 无法删除旧产物，已改名为 ${path.basename(aside)}`);
    return true;
  } catch (e) {
    console.log(`  ! 旧产物未能让路（${e.code || e.message}），打包可能失败`);
    return false;
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function main() {
  if (!fs.existsSync(DIST_HTML)) {
    throw new Error('还没有构建产物，请先执行： npm run build');
  }

  /* ---------- 1. 暂存 ---------- */
  rmrf(STAGE);
  fs.mkdirSync(STAGE, { recursive: true });

  copyFile(DIST_HTML, path.join(STAGE, 'dist', 'starstrike.html'));
  copyFile(path.join(ROOT, 'electron', 'main.js'), path.join(STAGE, 'electron', 'main.js'));
  if (fs.existsSync(path.join(ROOT, 'assets', 'icon.ico'))) {
    copyFile(path.join(ROOT, 'assets', 'icon.ico'), path.join(STAGE, 'assets', 'icon.ico'));
  }

  // 精简的 package.json：只保留 Electron 运行期需要的字段
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pkg = {
    name: src.name,
    productName: '星锋突击 STARSTRIKE',
    version: src.version,
    description: src.description,
    // electron-packager 强制要求 author 字段，缺失会直接拒绝打包
    author: src.author || { name: 'STARSTRIKE', email: 'starstrike@example.com' },
    type: 'commonjs',
    main: 'electron/main.js',
    license: 'MIT',
    private: true,
  };
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');

  const stageSize =
    fs.statSync(path.join(STAGE, 'dist', 'starstrike.html')).size;
  console.log(`✓ 暂存完成 build/stage（游戏包 ${(stageSize / 1024).toFixed(0)} KB）`);

  /* ---------- 2. 打包 ---------- */
  const packagerBin = path.join(ROOT, 'node_modules', 'electron-packager', 'bin', 'electron-packager.js');
  if (!fs.existsSync(packagerBin)) throw new Error('未找到 electron-packager，请先执行 npm install');

  /*
   * 预先清掉上一次的输出目录。
   * electron-packager 的 --overwrite 内部走 safe-delete → 系统回收站，
   * 在某些 Windows 环境下会直接抛 "Error during a `trash` operation"（即使文件并未被占用）。
   * 自己用 fs.rmSync 先删干净，--overwrite 就无事可做，问题绕开。
   */
  const OUTDIR_EXPECTED = path.join(ROOT, OUTNAME, `${APPNAME}-${PLATFORM}-${ARCH}`);
  let outRoot = OUTNAME;
  if (!clearOutDir(OUTDIR_EXPECTED)) {
    /* 连改名都被拒（典型原因：上一次产物里的 app.asar 被系统句柄锁住，
     * 但已经查不到持有它的进程），此时只能换一个输出根目录，
     * 保证打包能出结果，而不是整个流程卡死。 */
    let n = 2;
    for (;;) {
      const cand = `${OUTNAME}-r${n}`;
      if (clearOutDir(path.join(ROOT, cand, `${APPNAME}-${PLATFORM}-${ARCH}`))) { outRoot = cand; break; }
      n++;
      if (n > 20) throw new Error('找不到可写入的输出目录');
    }
    console.log(`  → 改用输出目录 ${outRoot}（原目录被占用或不可删除）`);
  }

  // 让 electron-packager 复用本地已下载好的 Electron，避免重复走网络
  fs.mkdirSync(path.join(ROOT, 'build', 'cache'), { recursive: true });

  const args = [
    packagerBin,
    STAGE,
    APPNAME,
    `--platform=${PLATFORM}`,
    `--arch=${ARCH}`,
    `--out=${outRoot}`,
    '--overwrite',
    '--prune=true',
    '--asar',
    `--app-version=${src.version}`,
    '--electron-version=32.3.3',
    '--build-version=1.0.0',
  ];
  if (fs.existsSync(path.join(STAGE, 'assets', 'icon.ico'))) {
    args.push('--icon=' + path.join(STAGE, 'assets', 'icon.ico'));
  }

  console.log(`\n▶ 正在打包 ${PLATFORM}/${ARCH} …（首次会下载 Electron 运行时，请耐心等待）\n`);
  await run(process.execPath, args, {
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
      electron_config_cache: path.join(ROOT, 'build', 'cache'),
    },
  });

  /* ---------- 3. 报告 ---------- */
  const outDir = path.join(ROOT, outRoot);
  const dirs = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((d) => fs.statSync(path.join(outDir, d)).isDirectory())
    : [];
  console.log('\n✓ 打包完成');
  for (const d of dirs) {
    const full = path.join(outDir, d);
    let bytes = 0;
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const c = path.join(p, e.name);
        if (e.isDirectory()) walk(c);
        else bytes += fs.statSync(c).size;
      }
    };
    walk(full);
    console.log(`   ${d}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    const exe = PLATFORM === 'win32' ? `${APPNAME}.exe` : PLATFORM === 'darwin' ? `${APPNAME}.app` : APPNAME;
    console.log(`   启动文件: ${path.join(full, exe)}`);
  }
}

main().catch((e) => {
  console.error('\n✖ 打包失败：', e.message);
  process.exit(1);
});
