/**
 * 从设计稿图标库生成 src/utils/icons.ts
 *
 * 图标库是设计交付的唯一图标来源（设计规范 v1.1 第 9 节「勿再找图标」），
 * 本脚本把 28 个单色 ic-*.svg 原样内联进 icons.ts（currentColor 可换色），
 * 保证代码内矢量与交付库逐字节一致。
 *
 * 用法：在 uniapp/ 下执行 `node scripts/gen-icons.mjs`
 * 设计库更新后重跑即可（多色 face-* / monitor-wave 不走本脚本，按静态资源用）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = join(__dirname, '..', 'disign', '宝宝监控App-图标库');
const OUT_FILE = join(__dirname, '..', 'src', 'utils', 'icons.ts');

const svgs = readdirSync(LIB_DIR)
  // ic-monitor-wave 是多色插画（7 个多色之一），不走单色内联，按静态资源用
  .filter(f => f.startsWith('ic-') && f.endsWith('.svg') && f !== 'ic-monitor-wave.svg')
  .sort();

if (svgs.length !== 28) {
  console.error(`预期 28 个单色图标（ic-*.svg），实际 ${svgs.length} 个，请核对图标库`);
  process.exit(1);
}

const entries = svgs.map((file) => {
  const key = file.replace(/^ic-/, '').replace(/\.svg$/, '');
  const raw = readFileSync(join(LIB_DIR, file), 'utf8').trim();
  if (raw.includes('\'')) {
    console.error(`${file} 含单引号，无法安全内联`);
    process.exit(1);
  }
  return { key, raw };
});

const keyUnion = entries
  .map((e, i) => `${i === 0 ? '  = | ' : '    | '}'${e.key}'`)
  .join('\n');
const iconEntries = entries.map(e => `  '${e.key}':\n    '${e.raw}',`).join('\n\n');

const output = `/**
 * 集中管理所有 SVG 图标字符串（单色，统一 currentColor 换色）
 * 通过 base64 data URI 方式渲染，兼容 H5 / 小程序 / APP
 *
 * 图标来源：uniapp/disign/宝宝监控App-图标库/（设计规范 v1.1 第 9 节交付实体）
 * 本文件由 scripts/gen-icons.mjs 生成，勿手改 —— 图标库更新后重跑脚本
 *
 * 为什么不直接用 encodeURIComponent:
 *   - encodeURIComponent 会把 SVG 内的 \`#ffffff\` 编码为 \`%23ffffff\`，
 *     这个字面值出现在 SVG 的 fill 属性里，解析器看到的是 \`%23ffffff\`，
 *     颜色失效，整张图标可能直接不显示。
 *   - base64 编码只是把整段 SVG 包装成合法的 data URI 语法，
 *     不会改变 SVG 内部内容，浏览器 / 小程序解码后仍能正确解析。
 */
export type IconKey
${keyUnion};

const ICONS: Record<IconKey, string> = {
${iconEntries}
};

/**
 * 将字符串做 UTF-8 -> base64 编码，兼容浏览器与 Node 环境
 */
function utf8ToBase64(s: string): string {
  if (typeof btoa !== 'undefined') {
    return btoa(unescape(encodeURIComponent(s)));
  }
  // 纯 JS 实现，兼容小程序等无 btoa / Buffer 的环境
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = unescape(encodeURIComponent(s));
  let output = '';
  let i = 0;
  while (i < str.length) {
    const a = str.charCodeAt(i++);
    const b = str.charCodeAt(i++);
    const c = str.charCodeAt(i++);
    const i1 = a >> 2;
    const i2 = ((a & 3) << 4) | (b >> 4);
    const i3 = ((b & 15) << 2) | (c >> 6);
    const i4 = c & 63;
    if (Number.isNaN(b)) {
      output += \`\${chars.charAt(i1) + chars.charAt(i2)}==\`;
    }
    else if (Number.isNaN(c)) {
      output += \`\${chars.charAt(i1) + chars.charAt(i2) + chars.charAt(i3)}=\`;
    }
    else {
      output += chars.charAt(i1) + chars.charAt(i2) + chars.charAt(i3) + chars.charAt(i4);
    }
  }
  return output;
}

/**
 * 获取图标的 base64 data URI
 * @param name   图标名
 * @param color  可选：替换 SVG 中的 currentColor（配合 BaseIcon 的 color prop）
 */
export function getIcon(name: IconKey, color?: string): string {
  const raw = color ? ICONS[name].replace(/currentColor/g, color) : ICONS[name];
  return \`data:image/svg+xml;base64,\${utf8ToBase64(raw)}\`;
}
`;

writeFileSync(OUT_FILE, output);
console.log(`已生成 ${OUT_FILE}（${entries.length} 个图标）`);
