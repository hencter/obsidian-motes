/**
 * v2.0.0: 导出功能。
 *
 * 支持的导出格式：
 *   1. Markdown (.md)  — 打包一份自包含的 md 文件，带 YAML frontmatter（包含导出时间、条数、过滤条件）
 *   2. HTML (.html)    — 带基础样式（深浅自适应）的静态 html，双击就能在浏览器看
 *   3. JSON (.json)    — 结构化数据，方便转给别的工具（如 flomo 导入）
 *
 * 导出范围：
 *   - 按当前筛选（复用 filter query），零重复代码
 *   - 批量数据，全部保存到 vault 里的 Motes/exports/ 目录（方便用户从 Obsidian 右键复制路径）
 *
 * 注意：
 *   - 不打包图片（图片链接保持原样，是 vault 内相对路径或外链）
 *   - 不做"长图拼接" —— 那是另一个很复杂的模块（需要 canvas + html2canvas 库），暂不做
 *   - 单个 memo 的"保存为图片"功能是另一个已有功能（card 右键菜单），和批量导出分开
 */

import { App, Notice, normalizePath } from "obsidian";
import { Memo } from "./types";
import { t, getCurrentLocale } from "./i18n";

export type ExportFormat = "md" | "html" | "json";

export interface ExportOptions {
  format: ExportFormat;
  /** 已经筛选好的 memos */
  memos: Memo[];
  /** 可读的筛选描述（比如 "本周" / "#工作 且 AI" / "全部"） */
  filterDesc: string;
  /** 导出目录（相对 vault 根），默认 "Motes/exports" */
  exportFolder: string;
}

/** 导出并写入 vault，返回新文件的路径 */
export async function exportMemos(app: App, opts: ExportOptions): Promise<string> {
  const { format, memos, filterDesc, exportFolder } = opts;
  if (memos.length === 0) {
    throw new Error(t("notice.exportEmpty"));
  }

  const folder = normalizePath(exportFolder);
  await ensureFolder(app, folder);

  // v2.0.19: 文件名增加 4 位随机后缀，避免同一分钟连点两次导出抛
  //   "File exists"（formatTimestamp 精度到分钟）
  const stamp = formatTimestamp(new Date());
  const rand = Math.random().toString(36).slice(2, 6);
  const filename = `Motes-export-${stamp}-${rand}.${format}`;
  const filePath = `${folder}/${filename}`;

  let content: string;
  switch (format) {
    case "md":
      content = renderMarkdown(memos, filterDesc);
      break;
    case "html":
      content = renderHtml(memos, filterDesc);
      break;
    case "json":
      content = renderJson(memos, filterDesc);
      break;
    default:
      throw new Error("Unknown export format");
  }

  await app.vault.create(filePath, content);
  new Notice(t("export.noticeDone", { n: memos.length, path: filePath }));
  return filePath;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  const af = app.vault.getAbstractFileByPath(folder);
  if (!af) await app.vault.createFolder(folder);
}

function formatTimestamp(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** md 导出：带 frontmatter + 按日期分组 */
function renderMarkdown(memos: Memo[], filterDesc: string): string {
  const now = new Date();
  const fm = [
    "---",
    `exported_by: Motes`,
    `exported_at: ${now.toISOString()}`,
    `count: ${memos.length}`,
    `filter: ${escapeYaml(filterDesc)}`,
    "---",
    "",
    `# ${t("export.mdTitle", { desc: filterDesc })}`,
    "",
    `> ${t("export.mdSummary", {
      date: now.toLocaleString(),
      count: t("list.totalCount", { n: memos.length }),
    })}`,
    "",
  ].join("\n");

  // 按日期分组
  const byDate = new Map<string, Memo[]>();
  for (const m of memos) {
    const arr = byDate.get(m.date) ?? [];
    arr.push(m);
    byDate.set(m.date, arr);
  }
  const sortedDates = [...byDate.keys()].sort().reverse(); // 新 → 旧

  const parts: string[] = [fm];
  for (const date of sortedDates) {
    parts.push(`## ${date}`);
    parts.push("");
    const items = byDate.get(date) ?? [];
    items.sort((a, b) => b.time.localeCompare(a.time)); // 同日内晚的在前
    for (const m of items) {
      parts.push(`- ${m.time}`);
      const indented = m.content
        .split("\n")
        .map((l) => (l === "" ? "" : `  ${l}`))
        .join("\n");
      parts.push(indented);
      parts.push("");
    }
  }
  return parts.join("\n");
}

function escapeYaml(s: string): string {
  return s.replace(/[":]/g, " ").replace(/\s+/g, " ").trim();
}

/** html 导出：自包含单 html，深浅自适应，排版精致（v2.0.1 重写）
 *
 * 设计理念：
 *   - 像一份"数字纪念册"而不是"数据导出"
 *   - 时间线感：日期作为大分组，笔记卡片垂直流动
 *   - 布局像 Motes 主视图的"精简版"，用户一看就熟悉
 *   - 深浅自适应 + 优雅字体栈 + 克制的配色
 *   - 不依赖外部 CDN，自包含单文件可离线看、可发邮件、可打印
 */
function renderHtml(memos: Memo[], filterDesc: string): string {
  const now = new Date();
  const css = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --bg-card: #ffffff;
  --fg: #2c2a28;
  --fg-muted: #8a857f;
  --fg-dim: #b5b0a9;
  --accent: #c08a5a;
  --accent-soft: rgba(192, 138, 90, 0.12);
  --border: rgba(0, 0, 0, 0.06);
  --border-strong: rgba(0, 0, 0, 0.12);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
  --tag-bg: #f0ebe3;
  --tag-fg: #7a5c3a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17171a;
    --bg-card: #1e1e22;
    --fg: #e8e6e1;
    --fg-muted: #9c968e;
    --fg-dim: #5c5852;
    --accent: #d9a579;
    --accent-soft: rgba(217, 165, 121, 0.14);
    --border: rgba(255, 255, 255, 0.06);
    --border-strong: rgba(255, 255, 255, 0.12);
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.25);
    --tag-bg: rgba(217, 165, 121, 0.12);
    --tag-fg: #d9a579;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.container {
  max-width: 720px;
  margin: 0 auto;
  padding: 64px 24px 96px;
}

/* 顶部标题区 */
.header {
  text-align: center;
  padding-bottom: 40px;
  margin-bottom: 48px;
  border-bottom: 1px solid var(--border);
  position: relative;
}
.header::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 48px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--accent);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 16px;
}
.brand-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  display: inline-block;
}
.title {
  font-size: 34px;
  font-weight: 300;
  margin: 0 0 12px;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.subtitle {
  font-size: 14px;
  color: var(--fg-muted);
  font-weight: 400;
}
.stat-strip {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-top: 28px;
  font-size: 13px;
}
.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat-num {
  font-size: 22px;
  font-weight: 500;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.stat-label {
  color: var(--fg-dim);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* 日期分组 */
.day-group {
  margin-bottom: 40px;
}
.day-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-muted);
  padding: 6px 0 18px;
  letter-spacing: 0.04em;
  border-bottom: 1px dashed var(--border);
  margin-bottom: 20px;
}
.day-head-date {
  color: var(--fg);
  font-size: 15px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.day-head-weekday {
  color: var(--fg-dim);
  font-size: 12px;
}
.day-head-count {
  margin-left: auto;
  color: var(--fg-dim);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* memo 卡片 */
.memo {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
  transition: border-color 0.15s, transform 0.15s;
}
.memo:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.memo-time {
  font-size: 11px;
  color: var(--fg-dim);
  font-family: "SF Mono", ui-monospace, "JetBrains Mono", Consolas, monospace;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
  font-variant-numeric: tabular-nums;
}
.memo-body {
  font-size: 15px;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}
.memo-body p { margin: 0.4em 0; }
.memo-body p:first-child { margin-top: 0; }
.memo-body p:last-child { margin-bottom: 0; }
.memo-body a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--accent-soft);
}
.memo-body a:hover {
  border-bottom-color: var(--accent);
}
.memo-body code {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: "SF Mono", ui-monospace, Consolas, monospace;
}
.memo-body ul, .memo-body ol {
  padding-left: 1.5em;
  margin: 0.4em 0;
}
.memo-body h1, .memo-body h2, .memo-body h3,
.memo-body h4, .memo-body h5, .memo-body h6 {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.35;
  color: var(--fg);
}
.memo-body h1 { font-size: 1.5em; }
.memo-body h2 { font-size: 1.3em; }
.memo-body h3 { font-size: 1.15em; }
.memo-body h4, .memo-body h5, .memo-body h6 { font-size: 1em; }
.memo-body blockquote {
  margin: 0.5em 0;
  padding: 0.2em 0 0.2em 14px;
  border-left: 3px solid var(--accent-soft);
  color: var(--fg-muted);
  font-style: italic;
}
.memo-body pre {
  background: var(--accent-soft);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.88em;
  line-height: 1.55;
}
.memo-body pre code {
  background: transparent;
  color: var(--fg);
  padding: 0;
  border-radius: 0;
  font-size: 1em;
}
.memo-body hr {
  border: none;
  border-top: 1px dashed var(--border);
  margin: 1em 0;
}
.memo-body del {
  color: var(--fg-dim);
}
/* 待办列表样式（export-only，和 Obsidian 主视图无关） */
.memo-body ul.task-list {
  list-style: none;
  padding-left: 0.2em;
}
.memo-body ul.task-list li.task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 0;
}
.memo-body ul.task-list li.task-item input[type="checkbox"] {
  margin: 0;
  margin-top: 0.32em;
  flex-shrink: 0;
  accent-color: var(--accent);
  cursor: default;
}
.memo-body ul.task-list li.task-item.is-checked > span {
  color: var(--fg-dim);
  text-decoration: line-through;
}

/* 标签 */
.memo-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.tag {
  display: inline-block;
  background: var(--tag-bg);
  color: var(--tag-fg);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* 页脚 */
.footer {
  margin-top: 72px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
  text-align: center;
  color: var(--fg-dim);
  font-size: 12px;
  letter-spacing: 0.04em;
}
.footer a {
  color: var(--fg-muted);
  text-decoration: none;
  border-bottom: 1px solid var(--border);
}

/* 打印友好 */
@media print {
  body { background: #fff; color: #000; }
  .memo { page-break-inside: avoid; box-shadow: none; border-color: #ddd; }
  .header { break-after: avoid; }
}

/* 响应式 */
@media (max-width: 560px) {
  .container { padding: 32px 16px 48px; }
  .title { font-size: 26px; }
  .stat-strip { gap: 20px; }
  .memo { padding: 14px 16px; }
}
  `.trim();

  const byDate = new Map<string, Memo[]>();
  for (const m of memos) {
    const arr = byDate.get(m.date) ?? [];
    arr.push(m);
    byDate.set(m.date, arr);
  }
  const sortedDates = [...byDate.keys()].sort().reverse();

  // 统计
  const dayCount = sortedDates.length;
  const tagSet = new Set<string>();
  for (const m of memos) for (const t of m.tags) tagSet.add(t);

  const locale = getCurrentLocale();
  const weekdayNamesCN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekdayNamesEN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayNames = locale === "en-US" ? weekdayNamesEN : weekdayNamesCN;
  const getWeekday = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    return weekdayNames[d.getDay()] ?? "";
  };

  const parts: string[] = [];
  parts.push("<!DOCTYPE html>");
  parts.push(`<html lang="${locale}">`);
  parts.push("<head>");
  parts.push('<meta charset="UTF-8">');
  parts.push(
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
  );
  parts.push(`<title>Motes · ${escapeHtml(filterDesc)}</title>`);
  parts.push("<style>" + css + "</style>");
  parts.push("</head>");
  parts.push("<body>");
  parts.push('<div class="container">');

  // 顶部标题区
  parts.push('<header class="header">');
  parts.push(
    '<div class="brand"><span class="brand-dot"></span>Motes</div>'
  );
  parts.push(`<h1 class="title">${escapeHtml(filterDesc)}</h1>`);
  parts.push(
    `<p class="subtitle">${t("export.exportedAt", { date: formatDateFull(now, locale) })}</p>`
  );
  parts.push('<div class="stat-strip">');
  parts.push(
    `<div class="stat-item"><div class="stat-num">${memos.length}</div><div class="stat-label">${t("stats.memos")}</div></div>`
  );
  parts.push(
    `<div class="stat-item"><div class="stat-num">${dayCount}</div><div class="stat-label">${t("stats.days")}</div></div>`
  );
  parts.push(
    `<div class="stat-item"><div class="stat-num">${tagSet.size}</div><div class="stat-label">${t("stats.tags")}</div></div>`
  );
  parts.push("</div>");
  parts.push("</header>");

  // memos
  for (const date of sortedDates) {
    parts.push('<section class="day-group">');
    parts.push(
      `<div class="day-head"><span class="day-head-date">${date}</span>` +
        `<span class="day-head-weekday">${getWeekday(date)}</span>` +
        `<span class="day-head-count">${t("list.totalCount", { n: (byDate.get(date) ?? []).length })}</span></div>`
    );
    const items = byDate.get(date) ?? [];
    items.sort((a, b) => a.time.localeCompare(b.time)); // 同日内早的在前（与 Motes 文件规范一致）
    for (const m of items) {
      parts.push('<article class="memo">');
      parts.push(`<div class="memo-time">${m.time}</div>`);
      // 剥掉 memo content 里的标签（因为下面会单独列）
      const contentClean = m.content
        .replace(/#[^\s#]+/g, "")
        .replace(/\s+$/gm, "")
        .trim();
      // 简易 md 渲染：换行 + 粗体 + 斜体 + 链接 + 行内代码
      parts.push(
        '<div class="memo-body">' + renderInlineMd(contentClean) + "</div>"
      );
      if (m.tags.length > 0) {
        const tagsHtml = m.tags
          .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
          .join("");
        parts.push('<div class="memo-tags">' + tagsHtml + "</div>");
      }
      parts.push("</article>");
    }
    parts.push("</section>");
  }

  // footer
  parts.push('<footer class="footer">');
  parts.push(
    `<a href="https://github.com/i-iooi-i/obsidian-Motes" target="_blank" rel="noopener">${t("export.footer")}</a>`
  );
  parts.push("</footer>");

  parts.push("</div>");
  parts.push("</body></html>");
  return parts.join("\n");
}

/** 格式化日期：中文 "2026年5月6日 周三 13:30" / 英文 "Wed, 5/6/2026 13:30" */
function formatDateFull(d: Date, locale: "zh-CN" | "en-US"): string {
  const wdCN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  const wdEN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (locale === "en-US") {
    return `${wdEN}, ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wdCN} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** v2.0.5: 扩展 markdown 渲染，支持待办 / 列表 / 标题 / 引用 / 分割线 / 代码块
 *   处理顺序：先分"行级块"（代码块/标题/引用/列表/分割线/段落），再对每一行处理"行内"（粗/斜/code/link）
 *   HTML 字符在行内处理前转义，保证 XSS 安全 */
function renderInlineMd(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  const renderInline = (raw: string): string => {
    let html = escapeHtml(raw);
    // 行内代码（优先，避免内部的星号被误认为粗斜体）
    html = html.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
    // 链接 [text](url) —— 只识别 http(s)
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
    // 粗体 **xxx**
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // 斜体 *xxx*（不能匹配 **, lookbehind）
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    // 删除线 ~~xxx~~
    html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
    return html;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块 ```
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结尾 ```
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 标题 #..######
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const lv = hMatch[1].length;
      out.push(`<h${lv}>${renderInline(hMatch[2])}</h${lv}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join("<br>"))}</blockquote>`);
      continue;
    }

    // 待办 / 无序列表 / 有序列表（连续收集）
    const isTask = /^\s*[-*+]\s+\[([ xX])\]\s+/.test(line);
    const isUl = /^\s*[-*+]\s+/.test(line) && !isTask;
    const isOl = /^\s*\d+\.\s+/.test(line);
    if (isTask) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
        const mm = lines[i].match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!mm) break;
        const checked = mm[1].toLowerCase() === "x";
        const body = renderInline(mm[2]);
        items.push(
          `<li class="task-item${checked ? " is-checked" : ""}">` +
            `<input type="checkbox" disabled${checked ? " checked" : ""}>` +
            `<span>${body}</span></li>`
        );
        i++;
      }
      out.push(`<ul class="task-list">${items.join("")}</ul>`);
      continue;
    }
    if (isUl) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !/^\s*[-*+]\s+\[([ xX])\]\s+/.test(lines[i])) {
        const body = lines[i].replace(/^\s*[-*+]\s+/, "");
        items.push(`<li>${renderInline(body)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (isOl) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const body = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(`<li>${renderInline(body)}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 空行 → 段落分隔
    if (trimmed === "") {
      i++;
      continue;
    }

    // 普通段落：连续非空非块级行合并为一段，单换行转 <br>
    const pBuf: string[] = [line];
    i++;
    while (i < lines.length) {
      const nxt = lines[i];
      const nxtTrim = nxt.trim();
      if (
        nxtTrim === "" ||
        nxtTrim.startsWith("```") ||
        /^(#{1,6})\s+/.test(nxt) ||
        /^\s*(---|\*\*\*|___)\s*$/.test(nxt) ||
        /^\s*>\s?/.test(nxt) ||
        /^\s*[-*+]\s+/.test(nxt) ||
        /^\s*\d+\.\s+/.test(nxt)
      ) {
        break;
      }
      pBuf.push(nxt);
      i++;
    }
    out.push(`<p>${pBuf.map(renderInline).join("<br>")}</p>`);
  }

  return out.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON 导出：结构化数据 */
function renderJson(memos: Memo[], filterDesc: string): string {
  const data = {
     exported_by: "Motes",
    exported_at: new Date().toISOString(),
    filter: filterDesc,
    count: memos.length,
    memos: memos.map((m) => ({
      date: m.date,
      time: m.time,
      content: m.content,
      tags: m.tags,
      file: m.file,
    })),
  };
  return JSON.stringify(data, null, 2);
}
