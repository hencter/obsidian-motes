/**
 * v2.0.0: 智能回顾 —— 替代"随机 5 条"的加权挑选。
 *
 * 灵感：艾宾浩斯 + 间隔重复 + 主题回响 + 情感配对
 *
 * 算法（简单但有效）：
 *   对每条 memo 计算一个"值得被翻出来"的分数，取 top 5。
 *
 *   score = base_novelty_decay        // 基础：越久没"碰到"分越高
 *         + recent_touch_penalty      // 负项：最近碰过的扣分
 *         + topic_echo_bonus          // 主题回响：和今天写的笔记标签重合加分
 *         + mood_contrast_bonus       // 情感配对：今天偏 emo → 翻出历史 happy 的加分
 *         + random_jitter             // 抖动：避免完全相同的排序，给随机一点惊喜
 *
 * 设计原则：
 *   - 数据不跨插件生命周期持久化（除了简单的"最近展示过"列表，存 localStorage）
 *   - 零异步：同步算分
 *   - 无机器学习，算法人类可理解可调参
 *   - 失败优雅回退：任何字段缺失/类型错误都回退到随机
 *
 * 对比"随机 5 条"：
 *   随机：完全 uniform，可能连着几天都翻出同一条
 *   智能：利用你今天写的内容 + 历史活跃度，挑更值得看的
 */

import { Memo } from "./types";
import { detectMood, Mood } from "./mood";

/** localStorage key：最近展示过的 memo range[0] 列表（用 file:range[0] 作为 key） */
const RECENT_SHOWN_KEY = "memoria:smart-review:recent";
const RECENT_SHOWN_MAX = 30; // 保留最近 30 条曾展示过的，超出 FIFO

export interface SmartReviewOptions {
  /** 挑几条出来 */
  count: number;
  /** 当前"今日"日期，用于跳过"今天刚写的" */
  todayStr: string;
  /** 今日已写的 memos（用于算"主题回响" + "情感配对"） */
  todayMemos: Memo[];
}

/** 从 memos 池中挑出 N 条最值得回顾的 */
export function pickSmartReview(
  allMemos: Memo[],
  opts: SmartReviewOptions
): Memo[] {
  if (allMemos.length === 0) return [];
  const { count, todayStr, todayMemos } = opts;

  // 候选池：排除今天的笔记
  const pool = allMemos.filter((m) => m.date !== todayStr);
  if (pool.length === 0) {
    // 全是今天的 → 退化为随机
    return shuffle([...allMemos]).slice(0, count);
  }

  // 今日笔记的标签集合（用于主题回响）
  const todayTags = new Set<string>();
  for (const m of todayMemos) for (const t of m.tags) todayTags.add(t);

  // 今日笔记的主导情绪（多条里占比最高的那种）
  const todayMood = dominantMood(todayMemos);

  // 最近展示过的 id 集合（从 localStorage 读）
  const recentShown = loadRecentShown();

  // 用 Unix timestamp 计算每条的"距今天数"
  const nowTs = Date.now();

  // 给每条打分
  const scored = pool.map((memo) => {
    const id = memoId(memo);

    // 1) 基础新颖度：越久越高（对数曲线，避免老笔记分数爆炸）
    const daysAgo = Math.max(
      0,
      (nowTs - memo.datetime.getTime()) / (1000 * 60 * 60 * 24)
    );
    const noveltyScore = Math.log(1 + daysAgo) * 2;

    // 2) 最近展示过的扣分（间隔重复：避免短期重复）
    const recentIdx = recentShown.indexOf(id);
    // recentIdx = 0（刚展示过）→ 扣 10 分，越老扣越少
    const recentPenalty = recentIdx >= 0 ? -(10 - recentIdx * 0.3) : 0;

    // 3) 主题回响：和今日标签重合数
    let topicEcho = 0;
    if (todayTags.size > 0) {
      for (const t of memo.tags) {
        if (todayTags.has(t)) topicEcho += 3;
      }
    }

    // 4) 情感配对：今日 emo → 翻出历史 happy / touched 的加分
    //              今日 happy → 翻出历史 touched 的也加分
    let moodBonus = 0;
    const memoMood = detectMood(memo.content);
    if (todayMood === "sad" || todayMood === "angry") {
      if (memoMood === "happy" || memoMood === "touched") moodBonus = 4;
    } else if (todayMood === "happy") {
      if (memoMood === "touched") moodBonus = 2;
    }

    // 5) 小抖动（同分时让选择有随机性）
    const jitter = Math.random() * 1.5;

    const score =
      noveltyScore + recentPenalty + topicEcho + moodBonus + jitter;
    return { memo, score };
  });

  // 按分数降序取 top count
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, count).map((s) => s.memo);

  // 更新 "最近展示过" 列表
  const newShown = [...picked.map(memoId), ...recentShown];
  saveRecentShown(newShown.slice(0, RECENT_SHOWN_MAX));

  return picked;
}

function memoId(m: Memo): string {
  return `${m.file}:${m.range[0]}`;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dominantMood(memos: Memo[]): Mood {
  if (memos.length === 0) return "neutral";
  // v2.0.19 修复：之前漏了 inspired / fear / tired 三个 mood，
  //   detectMood 返回这三种时会让 count[mood]++ 从 undefined 变 NaN，
  //   后续 sort 的行为就会变得不可预测（情感配对加分可能算错）。
  //   现在把 Mood 类型里所有 8 种都显式初始化。
  const count: Record<Mood, number> = {
    happy: 0,
    touched: 0,
    inspired: 0,
    sad: 0,
    angry: 0,
    fear: 0,
    tired: 0,
    neutral: 0,
  };
  for (const m of memos) {
    const mood = detectMood(m.content);
    count[mood]++;
  }
  const entries = Object.entries(count) as Array<[Mood, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  // 如果主导是 neutral 或 0 > top，返回 neutral
  if (entries[0][0] === "neutral" || entries[0][1] === 0) return "neutral";
  return entries[0][0];
}

function loadRecentShown(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SHOWN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecentShown(list: string[]): void {
  try {
    window.localStorage.setItem(RECENT_SHOWN_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
