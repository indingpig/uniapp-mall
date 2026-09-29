# baby-monitor 图标字体 · 使用说明

> 字体家族：`baby-monitor`，前缀 `bmi-`，共 **28 个单色图标**。
> 生成方式：fantasticon（源 = 图标库 28 个 `ic-*.svg`，currentColor→黑后转轮廓）。
> **重新生成**：改 SVG 后运行主工作区 `iconfont-build/build.js` 即可（codepoint 稳定，新增图标自动追加）。

## 文件清单

| 文件 | 用途 |
|---|---|
| `baby-monitor.ttf` / `.woff` / `.woff2` | 字体文件（woff2 仅 2KB） |
| `baby-monitor.css` | **H5 / App** 用，字体路径指向 `/static/fonts/` |
| `baby-monitor-icons.wxss` | **微信小程序** 用，woff2 已 base64 内嵌（4.4KB，免网络加载） |
| `class-mapping.md` | 28 个类名 ↔ codepoint 映射表 |

## 集成步骤

### H5 / App（内嵌 WebView 渲染，SVG/本地字体均可用）
1. 把 `baby-monitor.ttf/.woff/.woff2` 拷到项目 `static/fonts/`；
2. `App.vue` 的 `<style>` 里 `@import "@/static/..."` 或直接引入 `baby-monitor.css`；
3. 用法：`<text class="bmi-mic" style="color:#7BA05B;font-size:20px" />`。

### 微信小程序
1. 把 `baby-monitor-icons.wxss` 拷到项目（如 `styles/`），在 `App.vue` 的 `<style>` 中 `@import "@/styles/baby-monitor-icons.wxss";`；
2. 用法同上：`<text class="bmi-bluetooth" style="color:#3B362E;font-size:22px" />`；
3. 注意：wxss 已内嵌 base64 字体，无需网络加载；**不要**再引入 baby-monitor.css（那是 H5 版路径）。

## 类名规范

- 类名 = `bmi-` + 图标名（去掉源文件 `ic-` 前缀），完整映射见 `class-mapping.md`；
- 颜色统一走 CSS `color`（与设计规范 9 节一致：激活绿 #7BA05B / 未激活 #A39B8C / 常规 #3B362E）；
- 尺寸走 `font-size`（图标按 24 viewBox 设计，font-size=24 时与设计稿 1:1）。

## 与设计稿的对应

| 设计稿图标（SVG 源） | 字体 class |
|---|---|
| ic-mic | .bmi-mic |
| ic-bell / ic-bell-off | .bmi-bell / .bmi-bell-off |
| ic-chevron-right / ic-chevron-left | .bmi-chevron-right / .bmi-chevron-left |
| ic-home / ic-clock / ic-bar-chart / ic-gear | .bmi-home / .bmi-clock / .bmi-bar-chart / .bmi-gear |
| ic-droplet / ic-activity / ic-moon | .bmi-droplet / .bmi-activity / .bmi-moon |
| ic-search / ic-radar | .bmi-search / .bmi-radar |
| ic-bluetooth / ic-bluetooth-off | .bmi-bluetooth / .bmi-bluetooth-off |
| ic-spinner / ic-stop | .bmi-spinner / .bmi-stop |
| ic-download / ic-eye / ic-plus | .bmi-download / .bmi-eye / .bmi-plus |
| ic-wifi / ic-wifi-signal / ic-wifi-off | .bmi-wifi / .bmi-wifi-signal / .bmi-wifi-off |
| ic-signal-bars / ic-signal-off | .bmi-signal-bars / .bmi-signal-off |
| ic-battery | .bmi-battery |
| ic-clock-empty | .bmi-clock-empty |

> 多色表情（face-*）与插画（monitor-wave）不进字体，走 `png3x/` 目录的 PNG @3x。
