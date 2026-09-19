# html-ppt-skill

> 面向 Agent 的 HTML 演示稿 Skill —— 用静态 HTML/CSS/JS 生成可直接投屏的 slides。
> **37 套主题** · **16 套完整 deck 模板** · **31 种页面布局** · **47 个动效** · **演讲者模式** · **V 键在线编辑**。
> 零构建，浏览器即开即用。

![HTML PPT Studio preview](docs/readme/hero.gif)

## 能力概览

| 模块 | 数量 | 说明 |
|---|---|---|
| 主题 | 37 | `assets/themes/*.css`，`T` 键切换 |
| 完整 deck 模板 | 16 | `templates/full-decks/<name>/` |
| 单页布局 | 31 | `templates/single-page/*.html` |
| CSS 动画 | 27 | `assets/animations/animations.css` |
| Canvas FX | 20 | `assets/animations/fx/*.js` |
| 演讲者模式 | — | `P` 键（同时打开 `?audience=1` 观众屏） |
| 交互式编辑 | — | `V` 键 / `assets/editor.js` |

## 核心特性

- **Token 驱动主题**：一份 CSS 变量文件切换整份 deck 视觉风格。
- **模板化生产**：从单页布局或完整 deck 模板快速 scaffold，替换内容即可。
- **现场演示**：键盘/滚轮翻页、左侧导览（`E`）、全屏总览（`O`）、演讲者窗口（`S`）。
- **在线编辑**：按 `V` 改文字、拖拽元素、调字号颜色，保存为 HTML。
- **数据动效**：数字递增、条形增长、SVG 路径描边等汇报常用动效。
- **图形化表达**：支持 SVG 图层与 Canvas FX，重点页可按主题叠加背景动效。

## 快速开始

安装到支持 Agent Skills 的环境：

```bash
npx skills add https://github.com/n66g4/html-ppt-skill
```

从模板创建演示稿：

```bash
./scripts/new-deck.sh my-report
open examples/my-report/index.html
```

Windows PowerShell：

```powershell
.\scripts\new-deck.ps1 my-report
Start-Process .\examples\my-report\index.html
```

对 Agent 的示例指令：

> 做一份 8 页技术分享 slides，用 tokyo-night 主题  
> 做一份 18 页正式汇报 HTML PPT，16:10，每页带演讲备注  
> 基于 outline 生成投资人 pitch deck

## 快捷键

| 键 | 功能 |
|---|---|
| `←` `→` `Space` | 翻页 |
| `F` | 全屏 |
| `S` | 演讲者模式 |
| `E` | 左侧页面导览 |
| `O` | 全屏页面总览 |
| `V` | 进入/退出编辑模式 |
| `T` | 切换主题 |
| `N` | 备注抽屉 |
| 编辑模式 `Ctrl+S` | 保存 HTML |
| 编辑模式 `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |

完整说明见 [references/presenter-mode.md](references/presenter-mode.md) 与 [SKILL.md](SKILL.md)。

## 主题

内置 37 套主题，包括 `minimal-white`、`corporate-clean`、`tokyo-night`、`aurora`、`blueprint`、`digitalgd` 等。浏览全部主题：

```bash
open templates/theme-showcase.html
```

按内容选 3 套候选主题写入 `data-themes`，默认主题与 `theme-link` 保持一致：

```html
<html data-themes="digitalgd,corporate-clean,arctic-cool" data-theme-base="../assets/themes/">
<link rel="stylesheet" id="theme-link" href="../assets/themes/digitalgd.css">
```

## 模板与布局

- **完整 deck**：`templates/full-decks/` — 开箱即用的多页 deck（含 `digitalgd` 政务科技风模板）。
- **单页布局**：`templates/single-page/` — cover、toc、kpi-grid、timeline、chart-bar 等 31 种。
- **Showcase**：`templates/theme-showcase.html`、`layout-showcase.html`、`animation-showcase.html`。

```bash
open templates/full-decks/digitalgd/index.html   # 12 页政务数据平台示例
open templates/full-decks-index.html             # 全部 deck 画廊
```

## 目录结构

```
html-ppt-skill/
├── SKILL.md                 Agent 入口
├── README.md
├── references/              主题、布局、动画、工作流文档
├── assets/
│   ├── base.css             共享 tokens
│   ├── runtime.js           导航 / 演讲者模式 / 总览
│   ├── editor.js            V 键编辑模式
│   ├── themes/*.css         37 主题
│   └── animations/          CSS 动画 + Canvas FX
├── templates/
│   ├── deck.html            最小起步模板
│   ├── full-decks/<name>/   16 套完整 deck
│   └── single-page/*.html   31 种布局
├── scripts/                 脚手架与截图工具
└── examples/                示例 deck
```

## 交付建议

- 默认 16:10 比例，正文/图表最小字号 ≥ 14px。
- 每页主体在页眉页脚之间视觉居中，避免溢出。
- 可见内容不写工具名、生成过程等元信息。
- 交付前建议截图检查布局，并验证翻页、导览、演讲者模式与编辑保存。

## 许可

基于 [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)（MIT）扩展。新增部分同 MIT License。
