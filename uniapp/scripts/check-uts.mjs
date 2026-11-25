#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
/**
 * UTS 插件本地编译自查（云端打包前的守门员）
 *
 * 为什么需要它：UTS 插件的编译错误只在**云端打包**时才暴露，一次排队约 20 分钟，
 * 而且云端日志只给 Kotlin 编译错误、不给编译 classpath —— 出错时只能靠猜。
 * 本脚本用 HBuilderX 自带的编译器（@dcloudio/uni-uts-v1 的 compile）和自带 kotlinc，
 * 在本机复现出一模一样的 Kotlin 与编译错误，秒级反馈。
 *
 * ⚠️ 本地跑一次永远比云端失败一次快。**改完任何 UTS 插件，先跑这个再提交基座。**
 *
 * 用法（在 uniapp/ 下）：
 *   node scripts/check-uts.mjs uts-wavrec
 *   node scripts/check-uts.mjs            # 不传则检查 src/uni_modules 下全部含 app-android 的插件
 *
 * 退出码：0 = 通过；1 = 有编译错误（可直接照报错改）；2 = 环境问题（找不到 HBuilderX 等）
 *
 * ⚠️ 准确度边界（务必理解，否则会误判既有插件）：
 *   本脚本复现的是「单文件 UTS → Kotlin → kotlinc」这一条主链路，对**不依赖 uni ExtAPI
 *   声明式类型**的插件（如 uts-wavrec）结果与云端一致 —— 它抓到的错误都是真的。
 *   但对引用了 `UniError` / `IUniError` / `@dcloudio/uni-app` ExtAPI 的插件
 *   （如 bin-bluetooth），真机构建会额外注入 ExtAPI 声明与组件上下文，本脚本缺这一层，
 *   会报出**假阳性**（典型：`unresolved reference 'UniError'`、`'errCode' overrides nothing`）。
 *
 *   因此：
 *   - 报错里有 `UniError`/`IUniError`/ExtAPI 相关 → 大概率假阳性，别去改那个插件；
 *   - 其余错误（okhttp 未解析、Number/Int 类型不符、catch 语法错等）→ 都是真错误；
 *   - 判断依据：该插件若在 dist/cache 下的 uni_modules/插件id/index.jar 里有产物，且源码
 *     md5 与 manifest.json 记录一致，说明云端曾成功编译过它，本次报错值得怀疑。
 *   - 拿不准时，用 `--list-jars` 打印 classpath，`unzip -l <jar> | grep 类名` 直接查证。
 *
 * 排查思路（脚本报 Unresolved reference 时）：
 *   1. 先看 AGENTS.md「UTS 插件开发避坑」的 okhttp 例外 —— 基座里是 DCloud 重打包的
 *      dc.squareup.* 命名空间，`import ... from 'okhttp3.X'` 云端必挂。
 *   2. 想确认某个类到底在不在编译 classpath：本脚本 `--list-jars` 会打印默认 classpath
 *      的 jar 清单，用 `unzip -l <jar> | grep 类路径` 即可查证。
 */
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

/* ------------------------------ HBuilderX 定位 ------------------------------ */

const HX_CANDIDATES = [
  process.env.DSH_HBUILDERX_PATH,
  '/Applications/HBuilderX.app/Contents/HBuilderX',
  'C:/Program Files/HBuilderX',
  'D:/HBuilderX',
  path.join(os.homedir(), 'HBuilderX'),
].filter(Boolean);

function findHBuilderX() {
  for (const p of HX_CANDIDATES) {
    if (existsSync(path.join(p, 'plugins'))) {
      return p;
    }
  }
  return null;
}

const HX = findHBuilderX();
if (!HX) {
  console.error('✗ 找不到 HBuilderX。用环境变量 DSH_HBUILDERX_PATH 指定其 Contents/HBuilderX 目录。');
  process.exit(2);
}

const PLUGINS = path.join(HX, 'plugins');
process.env.UNI_HBUILDERX_PLUGINS = PLUGINS;

const UTS_KOTLIN = path.join(PLUGINS, 'uniapp-uts-v1/node_modules/@dcloudio/uni-uts-v1/dist/kotlin.js');
const RUNEXT_MAIN = path.join(PLUGINS, 'uniapp-runextension/out/main.js');

for (const [name, p] of [['uni-uts-v1', UTS_KOTLIN], ['uniapp-runextension', RUNEXT_MAIN]]) {
  if (!existsSync(p)) {
    console.error(`✗ HBuilderX 缺少 ${name}（缺 UTS 插件编译能力，请更新 HBuilderX）: ${p}`);
    process.exit(2);
  }
}

const kotlin = require(UTS_KOTLIN);
const runExt = require(RUNEXT_MAIN);

/* ------------------------------ kotlinc 定位 ------------------------------ */

const KOTLINC = path.join(PLUGINS, 'uniapp-runextension/kotlinc/bin/kotlinc');
if (!existsSync(KOTLINC) && !existsSync(`${KOTLINC}.bat`)) {
  console.error(`✗ 找不到 HBuilderX 自带 kotlinc: ${KOTLINC}`);
  process.exit(2);
}
const kotlincPath = existsSync(KOTLINC) ? KOTLINC : `${KOTLINC}.bat`;

/** UTS 编译的默认 classpath（含 lib.5plus.base-release.jar，okhttp 的 dc.squareup.* 就在里面） */
function defaultJars() {
  return runExt.getDefaultJar ? runExt.getDefaultJar() : [];
}

if (process.argv.includes('--list-jars')) {
  for (const j of defaultJars()) {
    console.log(j);
  }
  process.exit(0);
}

/* ------------------------------ 主流程 ------------------------------ */

const UNIAPP_DIR = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(UNIAPP_DIR, 'src');
const MODULES_DIR = path.join(SRC_DIR, 'uni_modules');

function discoverPlugins() {
  if (!existsSync(MODULES_DIR)) {
    return [];
  }
  return readdirSync(MODULES_DIR).filter(id => existsSync(path.join(MODULES_DIR, id, 'utssdk/app-android/index.uts')));
}

const targets = process.argv.slice(2).filter(a => !a.startsWith('-'));
const plugins = targets.length > 0 ? targets : discoverPlugins();

if (plugins.length === 0) {
  console.error('✗ 没找到要检查的插件（src/uni_modules/*/utssdk/app-android/index.uts）');
  process.exit(2);
}

process.env.UNI_INPUT_DIR = SRC_DIR;
const OUT_ROOT = path.join(os.tmpdir(), 'uts-local-check');
process.env.UNI_OUTPUT_DIR = OUT_ROOT;

let failed = 0;

for (const pluginId of plugins) {
  const entry = path.join(MODULES_DIR, pluginId, 'utssdk/app-android/index.uts');
  if (!existsSync(entry)) {
    console.error(`✗ ${pluginId}: 没有 utssdk/app-android/index.uts`);
    failed++;
    continue;
  }

  console.log(`\n=== ${pluginId} ===`);

  // 1) UTS → Kotlin（与云端同一套编译器）
  let ktFile;
  try {
    // 注意：这里刻意绕过 runKotlinDev，因为它会走 gradle 解析 config.json 的
    // dependencies（本机没配 gradle 会直接崩）。真正决定能否编译的是默认 classpath，
    // 直接调 compile() 得到的 .kt 与云端一致。
    const result = await kotlin.compile(entry, {
      inputDir: SRC_DIR,
      outputDir: OUT_ROOT,
      sourceMap: false,
      components: false,
      customElements: false,
      isX: false,
      isSingleThread: false,
      isPlugin: true,
      isModule: false,
      isExtApi: false,
      extApis: {},
      transform: false,
      uniModules: plugins,
    });
    if (!result) {
      console.error('   ✗ UTS 转译无输出');
      failed++;
      continue;
    }
    if (result.error) {
      console.error('   ✗ UTS 语法/转译错误:');
      console.error(String(result.error));
      failed++;
      continue;
    }
    ktFile = path.join(OUT_ROOT, 'uni_modules', pluginId, 'utssdk/app-android/index.kt');
    if (!existsSync(ktFile)) {
      console.error(`   ✗ 未生成 Kotlin: ${ktFile}`);
      failed++;
      continue;
    }
    console.log('   ✓ UTS → Kotlin');
  }
  catch (e) {
    console.error(`   ✗ UTS 转译抛错: ${e?.message ?? e}`);
    failed++;
    continue;
  }

  // 2) kotlinc 编译（用云端等价的默认 classpath）
  const cp = defaultJars().join(path.delimiter);
  const jarOut = path.join(OUT_ROOT, `${pluginId}.jar`);
  try {
    execFileSync(kotlincPath, [ktFile, '-cp', cp, '-d', jarOut, '-nowarn'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    console.log('   ✓ Kotlin 编译通过');
  }
  catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    // 过滤 warning，只留 error
    const allErrors = out.split('\n').filter(l => /: error:/.test(l));
    // 已知假阳性特征：这些符号/类型要靠真机构建的 ExtAPI 注入层才能解析，本脚本不具备。
    // 判定原则：只匹配「ExtAPI 类型缺失」这一类，绝不吞掉真实错误（如 okhttp 未解析、
    // Number/Int 不符、catch 语法错）。
    const EXTAPI_PATTERNS = /UniError|IUniError|errSubject|'errCode' overrides nothing|unresolved reference 'errMsg'|Resolver' was expected|UTSJSONObject', but|UTSJSONObject'\)|expected 'CharacteristicRef', actual 'UTSJSONObject'|Function2<|property must be initialized, be final, or be abstract/;
    const errors = allErrors.filter(l => !EXTAPI_PATTERNS.test(l));
    const suppressed = allErrors.length - errors.length;

    if (errors.length === 0) {
      // 全部是 ExtAPI 假阳性 —— 视为通过，但明确告知
      console.log(`   ✓ Kotlin 编译通过（忽略 ${suppressed} 条 ExtAPI 假阳性，需云端最终确认）`);
      continue;
    }

    console.error(`   ✗ Kotlin 编译失败（${errors.length} 处真实错误${suppressed ? `，另忽略 ${suppressed} 条 ExtAPI 假阳性` : ''}）：`);
    for (const l of errors.slice(0, 40)) {
      console.error(`     ${l.replace(OUT_ROOT, '<out>')}`);
    }
    if (errors.length > 40) {
      console.error(`     ...还有 ${errors.length - 40} 处`);
    }
    const raw = path.join(OUT_ROOT, `${pluginId}.error.log`);
    try {
      writeFileSync(raw, out);
      console.error(`   完整日志: ${raw}`);
    }
    catch { /* ignore */ }
    console.error(`   生成的 Kotlin 保留在: ${ktFile}（可直接对照行号）`);
    failed++;
    continue;
  }
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} 个插件未通过。修好再提交云端基座，别浪费 20 分钟排队。`);
  process.exit(1);
}
console.log('✓ 全部通过；可以提交云端打包（cli pack --iscustom true）。');
