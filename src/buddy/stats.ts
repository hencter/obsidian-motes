/**
 * v2.1.0: 5 维属性计算 —— 把"用户的笔记行为"映射成宠物的 5 维属性
 *
 * v2.1.0-iter11 重写：让每一维都满足三个标准
 *   1. 直觉：看属性名能猜到含义
 *   2. 可控：用户知道做什么能升级
 *   3. 有上升空间：写得越多越升，不会瞬间拉满
 *
 * 与 Claude Code 原版基于"编程行为"不同，我们绑定 Motes 自己的信号源：
 *
 *   DEBUGGING（打磨力）= 结构化笔记的比例（含列表 / 任务 / 引用 / 链接 / 标题）
 *                       这种笔记是反复打磨过的，不是随手流水账
 *   PATIENCE （耐心值）= 平均字数的 sigmoid 映射（60 字 = 0.5，长短都有差异）
 *   CHAOS    （混沌气）= 最近 7 天 vs 历史平均的活跃度偏离（写得多/少都涨，稳定才降）
 *   WISDOM   （智慧光）= max(标签率, 双链率) + 0.3 × min(两者)
 *                       老用户标签已满 → 接近 1.0；同时用两种 → 额外加成
 *   SNARK    （吐槽欲）= 有明显情绪的笔记比例（复用 mood.ts，比括号正则准多了）
 *
 * 最终值 = base × 0.5 + (行为分 0~1) × 50
 *   - 物种 base 决定 0~50 的下限基线
 *   - 用户行为占 0~50 的上调空间
 *   - 极端用户（行为分 1.0）+ 高 base 物种 = 100 满分
 */

import { Memo } from "../types";
import { SPECIES } from "./species";
import { HatchedBuddy } from "./hatch";
import { detectMood } from "../mood";

export interface BuddyStats {
  debugging: number;
  patience: number;
  chaos: number;
  wisdom: number;
  snark: number;
}

/** 5 维属性的 key 列表（用于未来需要遍历所有维度的场景，比如导出或测试）*/
const STAT_KEYS = ["debugging", "patience", "chaos", "wisdom", "snark"] as const;

/** 主入口：根据宠物 + 用户笔记数据，计算当前 5 维属性（每项 0-100） */
export function computeStats(buddy: HatchedBuddy, memos: Memo[]): BuddyStats {
  const base = SPECIES[buddy.species].base;
  const beh = computeBehaviorScores(memos);

  return {
    debugging: clamp(base.debugging * 0.5 + beh.debugging * 50),
    patience:  clamp(base.patience  * 0.5 + beh.patience  * 50),
    chaos:     clamp(base.chaos     * 0.5 + beh.chaos     * 50),
    wisdom:    clamp(base.wisdom    * 0.5 + beh.wisdom    * 50),
    snark:     clamp(base.snark     * 0.5 + beh.snark     * 50),
  };
}

/** 行为评分：每个维度产出一个 0-1 的标准分 */
function computeBehaviorScores(memos: Memo[]): BuddyStats {
  if (memos.length === 0) {
    // 无数据：所有维度都给 0.5（中性），让 base 主导
    return { debugging: 0.5, patience: 0.5, chaos: 0.5, wisdom: 0.5, snark: 0.5 };
  }

  // ============ DEBUGGING ============
  // "结构化"笔记比例：包含列表 / 任务 / 引用 / Markdown 链接 / 标题等结构的笔记。
  //   随手流水账 → 低；用心组织过的内容 → 高。
  //   v2.1.0-iter11: 替换原"平均字数"算法，避免和 PATIENCE 高度相关。
  //   如何升级：在笔记里多用 `- ` 列表 / `[ ] ` 任务 / `> ` 引用 / `[text](url)` 链接 / `# 标题`
  const structureRe = /(^|\n)(- \[[ xX]\]|- |\* |\d+\.\s|>\s|#{1,6}\s)|\[[^\]]+\]\([^)]+\)/m;
  const structured = memos.filter((m) => structureRe.test(m.content)).length;
  const debugging = clampF(structured / memos.length);

  // ============ PATIENCE ============
  // 平均字数 sigmoid 映射，中位数 60 字 = 0.5
  //   公式：1 / (1 + exp(-(avg - 60) / 50))
  //   - 平均 30 字 → ~0.27（短笔记多）
  //   - 平均 60 字 → 0.50（中等）
  //   - 平均 100 字 → 0.69
  //   - 平均 200 字 → 0.94
  //   v2.1.0-iter11: 替换原"≥100 字占比 + 0.2"，更平滑、更敏感
  //   如何升级：偶尔写一两条长一点的反思就能拉动平均值
  const totalChars = memos.reduce((s, m) => s + m.content.length, 0);
  const avgLen = totalChars / memos.length;
  const patience = clampF(1 / (1 + Math.exp(-(avgLen - 60) / 50)));

  // ============ CHAOS ============
  // 最近 7 天活跃度 vs 历史平均的偏离（绝对值）
  //   - 最近写得比平时多很多 → 涨（生活有起伏）
  //   - 最近一阵子没写 → 也涨（生活不稳定）
  //   - 一直平稳输出 → 降（regular life）
  //   v2.1.0-iter11: 替换原"变异系数"，用户更能感知和操控
  //   注：这里的"涨/降"是中性的，混沌气没有好坏之分（毒舌物种喜欢混沌，禅意物种喜欢稳定）
  //   如何升级：刻意改变写笔记的频率（多写或少写都行）
  const recent7d = memos.filter((m) => {
    const days = (Date.now() - m.datetime.getTime()) / 86400000;
    return days <= 7;
  }).length;
  // v2.1.0-iter18: 用 reduce 找最早时间戳，避免 Math.min(...) 在大数组上的栈风险
  //   Math.min/Math.max 用 spread 传 1k+ 参数在某些 JS 引擎里有性能问题甚至 RangeError
  let earliestTs = Infinity;
  for (const m of memos) {
    const ts = m.datetime.getTime();
    if (ts < earliestTs) earliestTs = ts;
  }
  const historyDays = Math.max(
    1,
    Math.ceil((Date.now() - earliestTs) / 86400000)
  );
  const historyAvg7d = (memos.length / historyDays) * 7; // 历史 7 天平均
  // 偏离比例：|recent - avg| / avg，截断到 [0, 2] 后压到 [0, 1]
  const deviation = historyAvg7d > 0
    ? Math.min(2, Math.abs(recent7d - historyAvg7d) / historyAvg7d) / 2
    : 0;
  const chaos = clampF(deviation);

  // ============ WISDOM ============
  // 标签 / 双链 取较大值为主分 + 较小值的小奖励
  //   v2.1.0-iter12 修正 iter11 的设计 bug：之前 0.6+0.4 加权会让"99% 标签 / 0 双链"
  //   的老用户永远封顶在 0.6，反而成了"给老用户设天花板"。
  //   现在改为 max(tag, link) + 0.3 × min，意思是：
  //     - 主要靠任意一种组织方式拉满（标签或双链都行）
  //     - 同时用两种 → 额外 30% 加成（最高奖励）
  //   实例：99.7% 标签 + 5% 双链 = 0.997 + 0.05*0.3 = ~1.0 ✓
  //   实例：50% 标签 + 50% 双链 = 0.5 + 0.5*0.3 = 0.65
  //   实例：0 标签 + 0 双链 = 0
  //   如何升级：给笔记加 #标签 或 [[双链]]
  const tagged = memos.filter(
    (m) => m.tags.filter((t) => t !== "置顶" && t !== "收藏").length > 0
  ).length;
  const linkRe = /\[\[[^\]]+\]\]/;
  const linked = memos.filter((m) => linkRe.test(m.content)).length;
  const tagRatio = tagged / memos.length;
  const linkRatio = linked / memos.length;
  const wisdom = clampF(
    Math.max(tagRatio, linkRatio) + Math.min(tagRatio, linkRatio) * 0.3
  );

  // ============ SNARK ============
  // 有明显情绪（非 neutral）的笔记比例
  //   v2.1.0-iter11: 复用 mood.ts 的关键词检测，干掉之前的"括号正则"误判
  //   "吐槽欲" 在我们这里更接近"情绪表达欲"——表情符号、情绪关键词、感叹号都算
  //   如何升级：写笔记时大胆表达情绪（开心、难过、感动、加油 ...）
  const moody = memos.filter((m) => detectMood(m.content) !== "neutral").length;
  const snark = clampF(moody / memos.length);

  return { debugging, patience, chaos, wisdom, snark };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function clampF(n: number): number {
  if (!isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/** 把 stats 渲染成"DEBUGGING ▓▓░░░ 41" 这种字符进度条
 *  当前未使用（render.ts 直接用 div 进度条），保留供"导出宠物状态为 markdown"等未来场景 */
export function renderStatBar(value: number, width = 10): string {
  const filled = Math.round((value / 100) * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

export { STAT_KEYS };
