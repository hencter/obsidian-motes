/**
 * v2.1.0-iter8: textarea 操作工具集
 *
 * 解决两个核心问题（来自 GitHub issue 反馈）：
 *
 *   1. 撤销栈保留：直接 `el.value = newText` 会清空浏览器原生 undo stack，
 *      导致用户按 Ctrl+Z 撤销不了。改用 setRangeText() / execCommand 'insertText'
 *      就能让操作进入 undo stack，Ctrl+Z 自然支持。
 *
 *   2. 选中包裹：用户在 Obsidian 里选中文本按 `**` 期望是加粗（包裹），
 *      但原生 textarea 默认是替换。
 *
 * ⚙️ 包裹策略（v2.1.0-iter9 重写：抛弃时间窗，改"前缀检测"）
 *
 *   单字符快捷键（选中后单按一次）：
 *     * → *x*       （斜体）
 *     ` → `x`       （行内代码）
 *
 *   双字符快捷键的实现：通过"已包裹再升级"实现
 *     选中 hello 按 *  → *hello*           （第一次：单字符包裹）
 *     再按 *（未选中）  → **hello**         （第二次：检测到光标前后已是 *x*，升级为 **x**）
 *
 *   "选中即双字符"：用户选中文本时这两个 99% 是要 markdown 格式
 *     选中 + 按 = → ==x==
 *     选中 + 按 ~ → ~~x~~
 *
 *   关键设计：双 * 升级**不依赖时间窗**，纯靠 DOM 状态判断（光标前是 *、再往前不是 *、
 *   且这是合法的 *x* 包裹结构）。这样人类正常按键速度都能稳定触发。
 *
 * 🧪 边界场景对照表（review 时确认过的，未来回归测试可参考）：
 *
 *   场景                                 输入       预期行为
 *   ─────────────────────────────────────────────────────────
 *   选中 hello 按 *                      `*`        包裹 *hello*
 *   *hello*| 按 *（光标贴右 *）           `*`        升级 **hello**
 *   **hello**| 按 *（已是 ** 状态）       `*`        普通输入 → ***
 *   abc| 按 *（光标前不是 *）             `*`        普通输入 → abc*
 *   `\n*line1*\n|line2*` 跨行 *xxx*      `*`        不升级（不跨行扫描）
 *   选中 hello 按 `                      `` ` ``    包裹 `hello`
 *   `hello`| 按 ` （第二次）              `` ` ``    普通输入 → `hello`` （` 不升级，因为 ``x`` 非合法语法）
 *   选中 hello 按 =                      `=`        直接双字符 ==hello==
 *   未选中按 = （如输入 1=2）             `=`        普通输入（不拦截）
 *   选中 hello 按 ~                      `~`        直接双字符 ~~hello~~
 *   IME 输入中文时按 *                   *          不拦截（走原生 IME）
 *   Ctrl/Cmd/Alt + * 等修饰键组合         *          不拦截（让快捷键 work）
 */

/** 安全替换 textarea/input 的范围内容，**保留浏览器 undo stack**
 *
 *  v2.1.0-iter9: Obsidian (Electron/Chromium) 的实测发现：
 *    - setRangeText() 虽然是标准 API，但**不会进入 undo stack**（实测确认）
 *    - execCommand('insertText') 虽然 deprecated 但**确实进 undo stack**（走"模拟键盘输入"路径）
 *  所以优先级颠倒过来：execCommand 第一，setRangeText 第二。
 */
export function replaceTextareaRange(
  el: HTMLTextAreaElement | HTMLInputElement,
  start: number,
  end: number,
  newText: string
): void {
  // 优先：execCommand('insertText') —— 实测在 Obsidian/Electron 里能保 undo
  try {
    el.focus();
    el.setSelectionRange(start, end);
    if (activeDocument.execCommand("insertText", false, newText)) {
      // execCommand 会触发 input 事件，无需手动派发
      return;
    }
  } catch (e) {
    /* 降级 */
  }
  // Fallback: setRangeText（标准但 undo 不可靠）
  if (typeof el.setRangeText === "function") {
    try {
      el.focus();
      el.setRangeText(newText, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    } catch (e) {
      /* 继续降级 */
    }
  }
  // 最后退路（会清 undo）
  el.value = el.value.slice(0, start) + newText + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + newText.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 全量替换 textarea 内容（保留 undo） */
export function setTextareaValue(
  el: HTMLTextAreaElement | HTMLInputElement,
  newText: string
): void {
  replaceTextareaRange(el, 0, el.value.length, newText);
}

/**
 * 选中包裹 keydown 处理器。view 层在 textarea keydown 时调用 handleKey()，
 * 返回 true 时调用方应 preventDefault。
 *
 * v2.1.0-iter9: 重构为"无状态 + DOM 检测"方案，不再依赖时间窗。
 */
export class WrapHandler {
  /**
   * @returns true = 已处理，调用方应 preventDefault；false = 正常输入
   */
  handleKey(e: KeyboardEvent, el: HTMLTextAreaElement): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    // IME composing 不拦截
    if (e.isComposing || (e as KeyboardEvent & { keyCode?: number }).keyCode === 229) {
      return false;
    }

    const key = e.key;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const hasSelection = end > start;
    const text = el.value;

    // ===== 单字符 ` =====
    if (key === "`") {
      // 双按升级：光标前是 ` 且匹配 `x` 结构 → `x` -> ``x`` ?
      // 但 ``x`` 在 markdown 里是错误语法（行内代码就一个 `）。
      // 所以 ` 不做升级，连按两次直接产生第二个 `（保留原生）。
      if (hasSelection) {
        const selected = text.slice(start, end);
        replaceTextareaRange(el, start, end, "`" + selected + "`");
        return true;
      }
      return false;
    }

    // ===== `*` —— 单按斜体，再按升级为 ** 粗体 =====
    if (key === "*") {
      // 升级检测：未选中 + 光标前是 `*` + 再往前找一个匹配的 `*` 包裹
      //   即当前文本看起来像 `...A*xxx*|...`（| 是光标），按 * 升级为 `...A**xxx**|...`
      if (!hasSelection && start > 0 && text[start - 1] === "*") {
        // 找匹配的左 `*`（必须是单 *，不是 **）
        // 从 start-2 开始往左扫，找到第一个 `*`
        const innerEnd = start - 1; // 右 * 的位置
        // 简单贪心：从 innerEnd-1 往左扫到行首或 `*`
        let leftStar = -1;
        for (let i = innerEnd - 1; i >= 0; i--) {
          const ch = text[i];
          if (ch === "\n") break; // 不跨行
          if (ch === "*") {
            // 必须是"单 *"：左边不能也是 *
            if (i > 0 && text[i - 1] === "*") break;
            leftStar = i;
            break;
          }
        }
        // 同时要求"内圈非空" + "不是已经的 **xxx**"（右 * 之前是普通字符不是 *）
        if (
          leftStar >= 0 &&
          innerEnd - leftStar > 1 // 内圈至少 1 字符
        ) {
          const inner = text.slice(leftStar + 1, innerEnd);
          // 把整个 *xxx* (leftStar 到 innerEnd inclusive) 替换为 **xxx**
          replaceTextareaRange(el, leftStar, innerEnd + 1, "**" + inner + "**");
          return true;
        }
      }
      // 单按：选中文本时包裹成 *x*
      if (hasSelection) {
        const selected = text.slice(start, end);
        replaceTextareaRange(el, start, end, "*" + selected + "*");
        return true;
      }
      // 没选中且不在升级位置 → 普通输入
      return false;
    }

    // ===== `=` `~` —— 选中即双字符包裹 =====
    if ((key === "=" || key === "~") && hasSelection) {
      const wrap = key + key;
      const selected = text.slice(start, end);
      replaceTextareaRange(el, start, end, wrap + selected + wrap);
      return true;
    }

    return false;
  }
}
