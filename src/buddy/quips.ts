/**
 * v2.1.0: 文案池 —— 宠物气泡里偶尔说的那一句话
 *
 * v2.1.0-iter4: 新增情绪感知 + 动态随机化。
 *   - 优先级最高的情境：读取用户今天（或最近几天）的笔记情绪，
 *     如果 dominant mood 是 sad/angry/tired/fear → 给温柔共情的话
 *     如果 dominant mood 是 happy/touched/inspired → 给同频呼应的话
 *   - 其他情境（深夜/周末/久不写）保留，但 pick 逻辑改为"每次渲染随机抖动"，
 *     而不是按小时稳定，让每次打开 Obsidian 都有新鲜感
 *
 * 设计原则（克制三原则）：
 *   1. 不打扰：每次显示最多 1 句
 *   2. 有意义：基于真实用户行为 + 情绪触发
 *   3. 有人味：像朋友说的话，不要"系统消息"冷冰冰
 *
 * 文案是 Motes 原创（不抄 Claude Code），但情境化触发借鉴了类似想法。
 */

import { Memo } from "../types";
import { t } from "../i18n";
import { HatchedBuddy } from "./hatch";
import { detectMood, Mood } from "../mood";

/** 选一句最贴当下情境的文案 */
export function pickQuip(buddy: HatchedBuddy, memos: Memo[]): string {
  const now = new Date();
  const hour = now.getHours();
  const todayStr = fmtDate(now);
  const todayMemos = memos.filter((m) => m.date === todayStr);

  // ===== 情绪共情 vs 情境触发：50/50 随机 =====
  //   v2.1.0-iter10: 情绪是优先级最高的信号，但不能"今天所有气泡都是情绪"。
  //   保留 50% 概率走情绪文案池，剩下 50% 走情境触发，让宠物的话题更多样。
  //   情绪检测源：今天的笔记 > 最近 3 天（今天没写时降级）
  const moodSource =
    todayMemos.length > 0
      ? todayMemos
      : memos.filter((m) => {
          const days = (now.getTime() - m.datetime.getTime()) / 86400000;
          return days <= 3;
        });

  if (moodSource.length > 0 && Math.random() < 0.5) {
    const dominant = dominantMood(moodSource);
    if (dominant !== "neutral") {
      return pick(`buddy.quip.mood.${dominant}`, buddy);
    }
  }

  // ===== 情境触发（优先级 1-7）=====

  // 1) 满每日目标
  if (todayMemos.length >= 5) {
    return pick("buddy.quip.goalDone", buddy);
  }

  // 2) 深夜写笔记（0-4 点）
  if (hour >= 0 && hour < 5 && todayMemos.length > 0) {
    return pick("buddy.quip.lateNight", buddy);
  }

  // 3) 久未打开
  if (memos.length > 0) {
    // v2.1.0-iter18: 用 reduce 替代 Math.max(...spread)，避免大数组栈风险
    let lastTs = 0;
    for (const m of memos) {
      const ts = m.datetime.getTime();
      if (ts > lastTs) lastTs = ts;
    }
    const daysSince = (Date.now() - lastTs) / (1000 * 60 * 60 * 24);
    if (daysSince >= 7) {
      return pick("buddy.quip.longGone", buddy);
    }
    if (daysSince >= 3) {
      return pick("buddy.quip.missYou", buddy);
    }
  }

  // 4) 凌晨 5-9 点（早起）
  if (hour >= 5 && hour < 9 && todayMemos.length > 0) {
    return pick("buddy.quip.earlyBird", buddy);
  }

  // 5) 周末（周六/周日）
  const dow = now.getDay();
  if (dow === 0 || dow === 6) {
    return pick("buddy.quip.weekend", buddy);
  }

  // 6) 今天写过笔记
  if (todayMemos.length > 0) {
    return pick("buddy.quip.wroteToday", buddy);
  }

  // 7) 今天还没写
  return pick("buddy.quip.idle", buddy);
}

/** 统计 memos 里的主导情绪
 *
 *  v2.1.0-iter10: 改为"全文整体识别"。之前 per-memo 投票的策略有缺陷 ——
 *    用户今天写了 5 条流水账（neutral）+ 1 条"今天好累"（tired），
 *    投票结果会是 neutral=5 > tired=1 → 主导 = neutral，无法触发情绪共情。
 *  现在把所有 memo 的内容拼起来当一段长文本传给 detectMood，让"累"这种
 *  强情绪关键词在整体里被识别到，更符合用户对"今天的主导情绪"的直觉。
 */
function dominantMood(memos: Memo[]): Mood {
  if (memos.length === 0) return "neutral";
  // 把所有 memo 内容拼成一大段（用换行分隔，避免词被错误粘连）
  const combined = memos.map((m) => m.content).join("\n");
  return detectMood(combined);
}

/** v2.1.0-iter5: 从候选池里随机选一条（扩容到每池 6 条候选）。
 *   之前按小时稳定（一小时内刷新不换），但用户反馈"每次打开 OB 都想看到不同的"，
 *   改成纯随机，候选池也从 3 条扩到 6 条避免重复感。*/
function pick(baseKey: string, buddy: HatchedBuddy): string {
  const candidates = [
    `${baseKey}.0`, `${baseKey}.1`, `${baseKey}.2`,
    `${baseKey}.3`, `${baseKey}.4`, `${baseKey}.5`,
  ];
  // 纯随机
  const idx = Math.floor(Math.random() * candidates.length);
  return t(candidates[idx]);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
