import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
/**
 * gen-iconfont.mjs — 从设计稿图标库（28 个 ic-*.svg）生成 baby-monitor 图标字体
 *
 * 管线：SVG 解析（svgpath）→ 描边采样展开（逐段矩形 + 圆帽并集，修掉 fantasticon 描边变实心的坑）
 *       → 填充形状保持精确曲线（TrueType on/off 点）→ fonteditor-core TTFWriter 合成
 *       → ttf2woff（fonteditor）/ wawoff2 压 WOFF2 → 产出 css/wxss/json/映射表
 *
 * 用法：node scripts/gen-iconfont.mjs
 * 产物：disign/宝宝监控App-图标库/iconfont/（覆盖交付）+ src/static/fonts/（H5 集成）
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import svgpath from 'svgpath';
import { compress as woff2Compress } from 'wawoff2';

const require_ = createRequire(import.meta.url);
const { TTFWriter } = require_('fonteditor-core');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIB = `${ROOT}disign/宝宝监控App-图标库/`;
const OUT = `${LIB}iconfont/`;
const FONTS = `${ROOT}src/static/fonts/`;
const FAMILY = 'baby-monitor';
const PREFIX = 'bmi-';
const VIEW = 24; // 图标 viewBox 24×24
const UPM = 1000; // unitsPerEm
const SCALE = UPM / VIEW;
const CIRCLE_SEGS = 24; // 圆帽多边形边数

/* ---------- 码点：沿用既有 baby-monitor.json，保证稳定 ---------- */
const codepoints = JSON.parse(readFileSync(`${OUT}baby-monitor.json`, 'utf8'));
const names = Object.keys(codepoints).sort();

/* ---------- SVG 元素提取 ---------- */
function parseSvg(svg) {
  if (/transform=/i.test(svg))
    throw new Error('SVG 含 transform 属性，本管线未支持');
  const elements = [];
  const re = /<(circle|rect|ellipse|line|path)\b([^>]*?)\/>/g;
  for (const m of svg.matchAll(re)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z0-9-]+)="([^"]*)"/gi)) attrs[a[1]] = a[2];
    elements.push({ tag: m[1], attrs });
  }
  return elements;
}

const num = (v, d = 0) => (v === undefined ? d : Number.parseFloat(v));
const f = x => Number.parseFloat(x);

/* ---------- 形状 → 路径 d（保留圆角/椭圆弧） ---------- */
function shapeToD(tag, a) {
  if (tag === 'circle') {
    const cx = num(a.cx);
    const cy = num(a.cy);
    const r = f(a.r);
    return `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`;
  }
  if (tag === 'ellipse') {
    const cx = num(a.cx);
    const cy = num(a.cy);
    const rx = f(a.rx);
    const ry = f(a.ry);
    return `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`;
  }
  if (tag === 'rect') {
    const x = num(a.x);
    const y = num(a.y);
    const w = f(a.width);
    const h = f(a.height);
    const r = Math.min(num(a.rx), w / 2, h / 2);
    if (!r)
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
  }
  if (tag === 'line')
    return `M ${f(a.x1)} ${f(a.y1)} L ${f(a.x2)} ${f(a.y2)}`;
  return null; // path 用自身 d
}

/* ---------- 端点弧 → 三次贝塞尔 ---------- */
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = fa === fs ? -1 : 1;
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - denom) / denom));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (l || 1))));
    if (ux * vy - uy * vx < 0)
      a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dTheta > 0)
    dTheta -= 2 * Math.PI;
  if (fs && dTheta < 0)
    dTheta += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const cubics = [];
  let th = theta1;
  let px = x1;
  let py = y1;
  for (let i = 0; i < segs; i++) {
    const th2 = th + delta;
    const cosT1 = Math.cos(th);
    const sinT1 = Math.sin(th);
    const cosT2 = Math.cos(th2);
    const sinT2 = Math.sin(th2);
    const e2x = cosP * rx * cosT2 - sinP * ry * sinT2;
    const e2y = sinP * rx * cosT2 + cosP * ry * sinT2;
    const d1x = -t * (cosP * rx * sinT1 + sinP * ry * cosT1);
    const d1y = -t * (sinP * rx * sinT1 - cosP * ry * cosT1);
    const d2x = -t * (cosP * rx * sinT2 + sinP * ry * cosT2);
    const d2y = -t * (sinP * rx * sinT2 - cosP * ry * cosT2);
    const ex = i === segs - 1 ? x2 : e2x;
    const ey = i === segs - 1 ? y2 : e2y;
    cubics.push([px + d1x, py + d1y, ex + d2x, ey + d2y, ex, ey]);
    px = ex;
    py = ey;
    th = th2;
  }
  return cubics;
}

/* ---------- 路径采样（描边展开用） ---------- */
function sampleSegments(segs) {
  const polylines = [];
  let pts = [];
  let cur = null;
  const pushPt = (x, y) => pts.push([x, y]);
  const sampleCubic = (p0, c1, c2, p1) => {
    const n = 10;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      pushPt(
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
      );
    }
  };
  for (const s of segs) {
    const [cmd, ...v] = s;
    if (cmd === 'M') {
      if (pts.length > 0)
        polylines.push(pts);
      cur = [v[0], v[1]];
      pts = [[cur[0], cur[1]]];
    }
    else if (cmd === 'L' || cmd === 'T') {
      cur = [v[0], v[1]];
      pushPt(cur[0], cur[1]);
    }
    else if (cmd === 'V') {
      cur = [cur[0], v[0]];
      pushPt(cur[0], cur[1]);
    }
    else if (cmd === 'H') {
      cur = [v[0], cur[1]];
      pushPt(cur[0], cur[1]);
    }
    else if (cmd === 'C') {
      const p1 = [v[4], v[5]];
      sampleCubic(cur, [v[0], v[1]], [v[2], v[3]], p1);
      cur = p1;
    }
    else if (cmd === 'Q') {
      const p1 = [v[2], v[3]];
      const c1 = [cur[0] + (v[0] - cur[0]) * 2 / 3, cur[1] + (v[1] - cur[1]) * 2 / 3];
      const c2 = [p1[0] + (v[0] - p1[0]) * 2 / 3, p1[1] + (v[1] - p1[1]) * 2 / 3];
      sampleCubic(cur, c1, c2, p1);
      cur = p1;
    }
    else if (cmd === 'A') {
      const cubics = arcToCubics(cur[0], cur[1], v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
      for (const c of cubics) {
        const p1 = [c[4], c[5]];
        sampleCubic(cur, [c[0], c[1]], [c[2], c[3]], p1);
        cur = p1;
      }
    }
    else if (cmd === 'Z') {
      // z 闭合：终点连回子路径起点（缺口段也要生成描边）
      if (pts.length > 0) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (pts.length > 1 && (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6))
          pts.push([first[0], first[1]]);
        polylines.push(pts);
      }
      pts = [];
    }
  }
  if (pts.length > 0)
    polylines.push(pts);
  return polylines;
}

/* ---------- 描边 → 矩形 + 圆帽并集（轮廓点阵） ---------- */
function strokeToContours(polylines, width) {
  const r = width / 2;
  const contours = [];
  const cap = (x, y) => {
    const contour = [];
    for (let i = 0; i < CIRCLE_SEGS; i++) {
      const a = (i / CIRCLE_SEGS) * Math.PI * 2;
      contour.push({ x: x + r * Math.cos(a), y: y + r * Math.sin(a), onCurve: true });
    }
    return contour;
  };
  for (const pts of polylines) {
    contours.push(cap(pts[0][0], pts[0][1]));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * r;
      const ny = (dx / len) * r;
      contours.push([
        { x: x1 + nx, y: y1 + ny, onCurve: true },
        { x: x2 + nx, y: y2 + ny, onCurve: true },
        { x: x2 - nx, y: y2 - ny, onCurve: true },
        { x: x1 - nx, y: y1 - ny, onCurve: true },
      ]);
    }
    for (let i = 1; i < pts.length; i++) contours.push(cap(pts[i][0], pts[i][1]));
  }
  return contours;
}

/* ---------- 填充路径 → 精确轮廓（TT on/off 点，弧转三次） ---------- */
function fillToContours(segs) {
  const contours = [];
  let contour = [];
  let cur = null;
  const pushOn = (x, y) => contour.push({ x, y, onCurve: true });
  const pushCubic = (c1x, c1y, c2x, c2y, x, y) => {
    contour.push({ x: c1x, y: c1y, onCurve: false });
    contour.push({ x: c2x, y: c2y, onCurve: false });
    pushOn(x, y);
  };
  for (const s of segs) {
    const [cmd, ...v] = s;
    if (cmd === 'M') {
      if (contour.length > 1)
        contours.push(contour);
      contour = [];
      cur = [v[0], v[1]];
      pushOn(cur[0], cur[1]);
    }
    else if (cmd === 'L' || cmd === 'T') {
      cur = [v[0], v[1]];
      pushOn(cur[0], cur[1]);
    }
    else if (cmd === 'V') {
      cur = [cur[0], v[0]];
      pushOn(cur[0], cur[1]);
    }
    else if (cmd === 'H') {
      cur = [v[0], cur[1]];
      pushOn(cur[0], cur[1]);
    }
    else if (cmd === 'C') {
      pushCubic(v[0], v[1], v[2], v[3], v[4], v[5]);
      cur = [v[4], v[5]];
    }
    else if (cmd === 'Q') {
      const c1 = [cur[0] + (v[0] - cur[0]) * 2 / 3, cur[1] + (v[1] - cur[1]) * 2 / 3];
      const c2 = [v[2] + (v[0] - v[2]) * 2 / 3, v[3] + (v[1] - v[3]) * 2 / 3];
      pushCubic(c1[0], c1[1], c2[0], c2[1], v[2], v[3]);
      cur = [v[2], v[3]];
    }
    else if (cmd === 'A') {
      const cubics = arcToCubics(cur[0], cur[1], v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
      for (const c of cubics) {
        pushCubic(c[0], c[1], c[2], c[3], c[4], c[5]);
        cur = [c[4], c[5]];
      }
    }
    else if (cmd === 'Z') {
      if (contour.length > 1)
        contours.push(contour);
      contour = [];
    }
  }
  if (contour.length > 1)
    contours.push(contour);
  return contours;
}

/* ---------- 单个 SVG → 字体坐标下的轮廓 ---------- */
function signedArea(contour) {
  let a = 0;
  for (let i = 0; i < contour.length; i++) {
    const p = contour[i];
    const q = contour[(i + 1) % contour.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function normalizeWinding(contours) {
  // TrueType nonzero 填充：所有轮廓统一为正绕向，避免重叠区域相互抵消
  for (const contour of contours) {
    if (signedArea(contour) < 0)
      contour.reverse();
  }
  return contours;
}

function svgToContours(svg) {
  const contours = [];
  for (const { tag, attrs } of parseSvg(svg)) {
    const strokeW = attrs.stroke && attrs.stroke !== 'none' ? num(attrs['stroke-width'], 1) : 0;
    const fillWanted = attrs.fill && attrs.fill !== 'none';
    const d = tag === 'path' ? attrs.d : shapeToD(tag, attrs);
    if (!d)
      continue;
    const segs = svgpath(d).abs().unshort().segments;
    if (strokeW > 0) {
      for (const contour of strokeToContours(sampleSegments(segs), strokeW)) contours.push(contour);
    }
    else if (fillWanted) {
      for (const contour of fillToContours(segs)) contours.push(contour);
    }
  }
  return normalizeWinding(contours);
}

/* ---------- 组装 ttfobj ---------- */
const emptyTtf = JSON.parse(readFileSync(`${ROOT}scripts/iconfont.empty.json`, 'utf8'));

const glyphs = [];
let maxPoints = 0;
let maxContours = 0;
for (const name of names) {
  const svg = readFileSync(`${LIB}ic-${name}.svg`, 'utf8');
  const rawContours = svgToContours(svg);
  const contours = rawContours.map(contour =>
    contour.map(p => ({ x: Math.round(p.x * SCALE), y: Math.round((VIEW - p.y) * SCALE), onCurve: p.onCurve })),
  );
  const xs = contours.flatMap(c => c.map(p => p.x));
  const ys = contours.flatMap(c => c.map(p => p.y));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  maxPoints = Math.max(maxPoints, contours.reduce((s, c) => s + c.length, 0));
  maxContours = Math.max(maxContours, contours.length);
  glyphs.push({
    name: `${PREFIX}${name}`,
    unicode: [codepoints[name]],
    advanceWidth: UPM,
    leftSideBearing: xMin,
    xMin,
    yMin,
    xMax,
    yMax,
    contours,
  });
}

const lsbList = glyphs.map(g => g.leftSideBearing);
const rsbList = glyphs.map(g => g.advanceWidth - g.xMax);
const ttfObj = {
  ...emptyTtf,
  head: { ...emptyTtf.head, unitsPerEm: UPM, created: Date.now(), modified: Date.now() },
  name: { ...emptyTtf.name, fontFamily: FAMILY, fullName: FAMILY, postScriptName: FAMILY, uniqueSubFamily: `${FAMILY} Regular`, version: 'Version 1.0' },
  hhea: {
    ...emptyTtf.hhea,
    ascent: UPM * 0.8,
    descent: -UPM * 0.2,
    advanceWidthMax: UPM,
    minLeftSideBearing: Math.min(...lsbList),
    minRightSideBearing: Math.min(...rsbList),
    xMaxExtent: Math.max(...glyphs.map(g => g.xMax)),
    numOfLongHorMetrics: glyphs.length,
  },
  maxp: { ...emptyTtf.maxp, numGlyphs: glyphs.length, maxPoints, maxContours },
  glyf: glyphs,
};

/* ---------- 写出 TTF / WOFF / WOFF2 ---------- */
const ttfBuf = new TTFWriter().write(ttfObj);
const woffBuf = require_('fonteditor-core').ttf2woff(ttfBuf.slice(0));
const woff2Buf = Buffer.from(await woff2Compress(new Uint8Array(ttfBuf)));
const hash = createHash('md5').update(woff2Buf).digest('hex').slice(0, 16);

mkdirSync(OUT, { recursive: true });
mkdirSync(FONTS, { recursive: true });
for (const [file, buf] of [['baby-monitor.ttf', Buffer.from(ttfBuf)], ['baby-monitor.woff', Buffer.from(woffBuf)], ['baby-monitor.woff2', Buffer.from(woff2Buf)]]) {
  writeFileSync(OUT + file, buf);
  copyFileSync(OUT + file, FONTS + file);
}

const faceCss = `@font-face {
    font-family: "${FAMILY}";
    src: url("/static/fonts/baby-monitor.woff2?${hash}") format("woff2"),
url("/static/fonts/baby-monitor.woff?${hash}") format("woff"),
url("/static/fonts/baby-monitor.ttf?${hash}") format("truetype");
}

i[class^="bmi-"]:before, i[class*=" bmi-"]:before {
    font-family: ${FAMILY} !important;
    font-style: normal;
    font-weight: normal !important;
    font-variant: normal;
    text-transform: none;
    line-height: 1;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
`;
const woff2B64 = woff2Buf.toString('base64');
const faceWxss = `@font-face {
    font-family: "${FAMILY}";
    src: url("data:font/woff2;base64,${woff2B64}") format("woff2");
}

i[class^="bmi-"]:before, i[class*=" bmi-"]:before {
    font-family: ${FAMILY} !important;
    font-style: normal;
    font-weight: normal !important;
    font-variant: normal;
    text-transform: none;
    line-height: 1;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
`;
writeFileSync(`${OUT}baby-monitor.css`, faceCss);
writeFileSync(`${OUT}baby-monitor-icons.wxss`, faceWxss);
writeFileSync(`${OUT}baby-monitor.json`, JSON.stringify(codepoints, null, 2));

const rows = names.map(n => `| ${n} | .${PREFIX}${n} | \\${codepoints[n].toString(16)} |`).join('\n');
writeFileSync(`${OUT}class-mapping.md`, `| 图标名 | class | content |\n|---|---|---|\n${rows}\n`);

console.warn(`[gen-iconfont] ${names.length} glyphs → ttf(${ttfBuf.byteLength}B) woff woff2(${woff2Buf.length}B) + css/wxss/json/mapping 已写入 iconfont/ 与 static/fonts/`);
