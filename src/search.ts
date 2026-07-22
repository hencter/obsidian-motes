/**
 * v2.0.0: 高级搜索查询解析器。
 *
 * 支持的语法（空格分隔，任意顺序）：
 *   - 普通关键词            `量子 工作室`  → 内容必须同时包含"量子"和"工作室"（AND）
 *   - 标签包含              `#标签`       → 必须带此标签（完全匹配 / 前缀匹配）
 *   - 标签排除              `-#标签`      → 排除带此标签的
 *   - 关键词排除            `-关键词`     → 排除内容含此词的
 *   - 日期范围 - 之后        `after:2024-01-01`  or  `after:2024-01`  or  `after:2024`
 *   - 日期范围 - 之前        `before:2024-12-31`
 *   - 精确日期              `date:2024-05-04`  (= after:2024-05-04 + before:2024-05-04)
 *   - 月份                  `date:2024-05`    (= 整月)
 *   - 年份                  `date:2024`       (= 整年)
 *
 * 示例：
 *   `#工作 -#PUBGM项目 AI after:2025-01-01 -愤怒`
 *   = 带 #工作 标签 + 不带 #PUBGM项目 标签 + 内容含"AI" + 2025 年之后 + 内容不含"愤怒"
 *
 * 设计原则：
 *   - 解析失败优雅回退：写错的过滤词会被当成普通关键词（如 `afte:2024` 不合法，当成普通关键词）
 *   - 零依赖（不用 chrono-node 等库），自己手写 date 解析
 *   - 返回结构化 Query 对象，让 view.ts 的筛选逻辑简单化
 */

export interface SearchQuery {
  /** 必须同时包含的关键词（AND） */
  includeTerms: string[];
  /** 必须不包含的关键词 */
  excludeTerms: string[];
  /** 必须带的标签（不含 #） */
  includeTags: string[];
  /** 必须不带的标签 */
  excludeTags: string[];
  /** 日期 >= afterDate（yyyy-MM-dd 字符串比较，null = 不限） */
  afterDate: string | null;
  /** 日期 <= beforeDate */
  beforeDate: string | null;
  /** 原始 query（用于展示） */
  raw: string;
}

/** 空查询：表示没有任何筛选条件 */
export const EMPTY_QUERY: SearchQuery = {
  includeTerms: [],
  excludeTerms: [],
  includeTags: [],
  excludeTags: [],
  afterDate: null,
  beforeDate: null,
  raw: "",
};

/** 把搜索框里的字符串解析为结构化 Query */
export function parseSearchQuery(raw: string): SearchQuery {
  const q: SearchQuery = {
    includeTerms: [],
    excludeTerms: [],
    includeTags: [],
    excludeTags: [],
    afterDate: null,
    beforeDate: null,
    raw: raw.trim(),
  };
  if (!q.raw) return q;

  // 按空格拆分 token（不支持引号包裹的短语匹配，简单优先）
  const tokens = q.raw.split(/\s+/).filter((t) => t.length > 0);

  for (const token of tokens) {
    // 排除前缀 "-"
    const isExclude = token.startsWith("-") && token.length > 1;
    const body = isExclude ? token.slice(1) : token;

    // 日期过滤：after: / before: / date:
    const dateMatch = body.match(/^(after|before|date):(.+)$/i);
    if (dateMatch) {
      const kind = dateMatch[1].toLowerCase() as "after" | "before" | "date";
      const value = dateMatch[2];
      const range = parseDateToken(value);
      if (range) {
        // 排除前缀对日期无意义，静默忽略（把它当普通关键词也怪怪的）
        if (kind === "after") {
          q.afterDate = pickLater(q.afterDate, range.start);
        } else if (kind === "before") {
          q.beforeDate = pickEarlier(q.beforeDate, range.end);
        } else {
          // date:xxx 等价于 after:start 且 before:end
          q.afterDate = pickLater(q.afterDate, range.start);
          q.beforeDate = pickEarlier(q.beforeDate, range.end);
        }
        continue;
      }
      // 解析失败：当普通关键词处理
    }

    // 标签（# 开头）
    if (body.startsWith("#") && body.length > 1) {
      const tagName = body.slice(1);
      if (isExclude) {
        q.excludeTags.push(tagName);
      } else {
        q.includeTags.push(tagName);
      }
      continue;
    }

    // 普通关键词
    if (isExclude) {
      q.excludeTerms.push(body);
    } else {
      q.includeTerms.push(body);
    }
  }
  return q;
}

/** 解析日期 token，返回 [start, end]（yyyy-MM-dd 字符串）
 *   "2024"        → [2024-01-01, 2024-12-31]
 *   "2024-05"     → [2024-05-01, 2024-05-31]
 *   "2024-05-04"  → [2024-05-04, 2024-05-04]
 */
function parseDateToken(s: string): { start: string; end: string } | null {
  // yyyy
  const yearRe = /^(\d{4})$/;
  // yyyy-MM
  const monthRe = /^(\d{4})-(\d{1,2})$/;
  // yyyy-MM-dd
  const dateRe = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

  let m = s.match(dateRe);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return { start: `${y}-${mo}-${d}`, end: `${y}-${mo}-${d}` };
  }
  m = s.match(monthRe);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    const moStr = mo.toString().padStart(2, "0");
    const lastDay = new Date(y, mo, 0).getDate(); // mo 是 1-based，Date 的 mo-1 才是该月，0 = 上月最后一天
    const dStr = lastDay.toString().padStart(2, "0");
    return { start: `${y}-${moStr}-01`, end: `${y}-${moStr}-${dStr}` };
  }
  m = s.match(yearRe);
  if (m) {
    const y = m[1];
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  return null;
}

/** 如果两个日期字符串都有值，取更晚那个；否则取有值的那个 */
function pickLater(a: string | null, b: string): string {
  if (!a) return b;
  return a > b ? a : b;
}
/** 取更早那个 */
function pickEarlier(a: string | null, b: string): string {
  if (!a) return b;
  return a < b ? a : b;
}

/** 一个 memo 是否匹配给定的 Query。
 *   - memo.content 检索大小写不敏感（用户搜 AI 应该能命中 "ai"）
 *   - 标签匹配支持前缀：搜 #工作 能命中 #工作/职场 */
export function matchesQuery(
  memoContent: string,
  memoTags: string[],
  memoDate: string,
  q: SearchQuery
): boolean {
  if (q.raw === "") return true;

  const lowerContent = memoContent.toLowerCase();

  // 关键词必须包含
  for (const term of q.includeTerms) {
    if (!lowerContent.includes(term.toLowerCase())) return false;
  }
  // 关键词必须不包含
  for (const term of q.excludeTerms) {
    if (lowerContent.includes(term.toLowerCase())) return false;
  }
  // 标签必须包含（前缀匹配：#工作 命中 #工作/职场）
  for (const tag of q.includeTags) {
    const hit = memoTags.some(
      (t) => t === tag || t.startsWith(tag + "/")
    );
    if (!hit) return false;
  }
  // 标签必须不包含（同样前缀）
  for (const tag of q.excludeTags) {
    const hit = memoTags.some(
      (t) => t === tag || t.startsWith(tag + "/")
    );
    if (hit) return false;
  }
  // 日期范围（字符串比较 yyyy-MM-dd 天然等价于日期比较）
  if (q.afterDate && memoDate < q.afterDate) return false;
  if (q.beforeDate && memoDate > q.beforeDate) return false;

  return true;
}

/** 高亮：把 memo 文本中匹配的关键词 wrap 成 <mark> 标签。
 *   - 只高亮 includeTerms（排除词不高亮，否则误导）
 *   - 标签也不高亮（标签胶囊已经是独立视觉元素）
 *   - 对原文转义后再替换，防止 XSS
 *   - 零 HTML 语义感知（不会破坏 code block 内的关键词，但会染色它们——这是预期的）
 *   返回一段**安全的 HTML 字符串**，调用方应该用 innerHTML 或 DOMParser 使用 */
export function highlightTerms(text: string, terms: string[]): string {
  if (terms.length === 0) return escapeHtml(text);
  // 把所有 term 按长度降序（长的优先匹配，避免"AI工具"先被"AI"拦胡）
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  // v2.0.19: 之前对原始 text 先 escapeHtml → 再用未 escape 的 term 去正则匹配，
  //   导致用户搜包含 HTML 特殊字符（如 `<script>`）的关键词永远匹配不到
  //   （目标文本里 `<` 已经变成 `&lt;`）。现在先 escapeHtml 两边，保证同域匹配。
  const escapedText = escapeHtml(text);
  const escapedTerms = sorted.map((x) => escapeRegExp(escapeHtml(x)));
  const pattern = escapedTerms.join("|");
  if (!pattern) return escapedText;
  const re = new RegExp(`(${pattern})`, "gi");
  return escapedText.replace(re, '<mark class="Motes-search-hit">$1</mark>');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
