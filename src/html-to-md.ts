/**
 * v2.0.0: 富文本剪贴板 → Markdown 转换。
 *
 * 目的：
 *   用户从 Word / 网页 / 微信文章复制内容到 Motes 输入框时，
 *   保留加粗/斜体/标题/列表/链接等结构，而不是只剩纯文本。
 *
 * 设计原则：
 *   - 零依赖（不引入 turndown / html-to-md 库，bundle size 敏感）
 *   - 保守：只处理明确且常见的语义标签，不明确的直接取 textContent
 *   - 白名单式：列出支持的标签，其他全部降级为文本
 *   - 安全：不执行任何内嵌 <script>，DOMParser 本身就是惰性的
 *
 * 支持的转换：
 *   <strong>/<b>   → **text**
 *   <em>/<i>        → *text*
 *   <code>          → `text`
 *   <pre>           → ``` text ```（多行代码块）
 *   <a href>        → [text](href)
 *   <img src alt>   → ![alt](src)
 *   <h1>-<h6>       → # text / ## text
 *   <ul><li>        → - text
 *   <ol><li>        → 1. text
 *   <blockquote>    → > text
 *   <br>            → 换行
 *   <p>/<div>       → 段落分隔
 *   <hr>            → ---
 *
 * 不支持的：表格（<table>）、脚注、复杂嵌套的富文本样式
 *   → 降级为 textContent 拼接
 */

/** 判断剪贴板的 HTML 是否值得走 md 转换路径 */
export function shouldConvertHtmlToMd(html: string): boolean {
  if (!html) return false;
  // 有典型语义标签就转
  const re = /<\/?(strong|b|em|i|a|h[1-6]|ul|ol|li|blockquote|pre|code|img|hr)[\s>]/i;
  return re.test(html);
}

/** v2.1.2: 判断 plain text 看起来已经是 markdown —— 如果是，粘贴时信任它，
 *   不走 HTML → Markdown 转换路径。
 *
 *   场景：用户从 Obsidian 主编辑器复制 `[[笔记]]` 或 `#标签`，剪贴板 plain text
 *   是原始 markdown 语法，但 HTML 版本是渲染后的 `<a class="internal-link">...</a>`，
 *   走 HTML 转换会把双链变成普通 `[text](url)` 链接。这个检测能让 plain text
 *   直通浏览器默认粘贴路径，保留原始 markdown 语法。
 *
 *   保守判据（避免误伤从 Word/网页复制带格式的场景）：
 *     - 含 [[...]] 双链 / ![[...]] 嵌入
 *     - 含行首 # 起头的标签或标题
 *     - 含 ``` 代码块
 *     - 含 **...** 加粗 / ==...== 高亮 等 markdown 显式标记
 */
export function looksLikeMarkdown(plain: string): boolean {
  if (!plain) return false;
  // [[xxx]] 双链 / ![[xxx]] 嵌入
  if (/\[\[[^\]]+\]\]/.test(plain)) return true;
  // ``` 代码块
  if (/```/.test(plain)) return true;
  // 行首 # 开头（标签或标题）—— 至少一个非空字符跟在 # 后面
  if (/(^|\n)#[^\s#]/.test(plain)) return true;
  // **粗体** / ==高亮== / ~~删除线~~
  if (/\*\*[^*\n]+\*\*|==[^=\n]+==|~~[^~\n]+~~/.test(plain)) return true;
  return false;
}


/** 把 HTML 字符串转为 Markdown */
export function htmlToMarkdown(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return nodeToMd(doc.body).trim();
  } catch {
    return "";
  }
}

function nodeToMd(node: Node, listDepth = 0, listType: "ul" | "ol" | null = null, olIndex = 1): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // 文本节点：压缩多余空白但保留单个空格；逃逸 md 特殊字符
    return (node.textContent ?? "")
      .replace(/\s+/g, " ")
      .replace(/([\\`*_{}[\]()#+\-.!])/g, "\\$1");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName;
  const children = Array.from(el.childNodes);

  // 处理子节点（对 li 的处理单独做，因为要知道自己在 ol 里的 index）
  const childText = (): string => {
    return children.map((c) => nodeToMd(c, listDepth, listType, olIndex)).join("");
  };

  switch (tag) {
    case "BR":
      return "\n";
    case "HR":
      return "\n---\n";
    case "STRONG":
    case "B":
      return "**" + childText().replace(/\\([*_])/g, "$1") + "**";
    case "EM":
    case "I":
      return "*" + childText().replace(/\\([*_])/g, "$1") + "*";
    case "CODE":
      // 行内代码：内容不做 md 转义
      return "`" + (el.textContent ?? "") + "`";
    case "PRE": {
      // 代码块
      const code = el.textContent ?? "";
      return "\n```\n" + code + "\n```\n";
    }
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const text = childText();
      if (!href) return text;
      return `[${text}](${href})`;
    }
    case "IMG": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      if (!src) return "";
      return `![${alt}](${src})`;
    }
    case "H1":
      return "\n# " + childText() + "\n";
    case "H2":
      return "\n## " + childText() + "\n";
    case "H3":
      return "\n### " + childText() + "\n";
    case "H4":
      return "\n#### " + childText() + "\n";
    case "H5":
      return "\n##### " + childText() + "\n";
    case "H6":
      return "\n###### " + childText() + "\n";
    case "BLOCKQUOTE": {
      const inner = childText().trim();
      return "\n" + inner.split("\n").map((l) => "> " + l).join("\n") + "\n";
    }
    case "UL": {
      let out = "\n";
      Array.from(el.children).forEach((c) => {
        if (c.tagName === "LI") {
          const indent = "  ".repeat(listDepth);
          const inner = Array.from(c.childNodes)
            .map((ch) => nodeToMd(ch, listDepth + 1, "ul", 1))
            .join("")
            .trim();
          out += `${indent}- ${inner}\n`;
        }
      });
      return out;
    }
    case "OL": {
      let out = "\n";
      let idx = 1;
      Array.from(el.children).forEach((c) => {
        if (c.tagName === "LI") {
          const indent = "  ".repeat(listDepth);
          const inner = Array.from(c.childNodes)
            .map((ch) => nodeToMd(ch, listDepth + 1, "ol", 1))
            .join("")
            .trim();
          out += `${indent}${idx}. ${inner}\n`;
          idx++;
        }
      });
      return out;
    }
    case "LI":
      // 独立处理（通常不会单独出现，都由 UL/OL 走）
      return childText();
    case "P":
    case "DIV":
    case "SECTION":
    case "ARTICLE":
      return "\n" + childText() + "\n";
    case "SCRIPT":
    case "STYLE":
    case "NOSCRIPT":
      return ""; // 安全：丢弃
    default:
      // 未列出的标签：透明传递子内容
      return childText();
  }
}
