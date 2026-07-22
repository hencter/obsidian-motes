/**
 * v2.1.0: 宠物视图渲染
 *
 * 把 buddy 状态渲染到侧栏的 overview 区。
 *
 * 最终结构（v2.1.0-iter18 克制版定稿）：
 *
 *   ┌──────────────────────────────────┐
 *   │ ★ 普通 · 成年        陪你 421 天 │  ← hover 才显示（绝对定位浮在上方）
 *   │                                   │     桌面端默认隐藏，移动端常显
 *   │             ✦ ✦                  │  ← 阶段气场（teen/adult 才有）
 *   │             [_]                   │
 *   │              |                    │
 *   │            /   \                  │  ← ASCII 主体
 *   │          ( · · )                  │
 *   │          (  ω  )                  │
 *   │           ┈┈┈┈┈                  │  ← 阶段气场（adult 才有）
 *   │                                   │
 *   │      吉吉 · 胖胖兽                │  ← 物种 hover 出 motto
 *   │                                   │
 *   │   打磨力 ░░░░░░ 15               │
 *   │   耐心值 ▓▓░░░░ 62               │  ← 5 维属性（去框去背景）
 *   │   混沌气 ░░░░░░ 19               │
 *   │   智慧光 ▓▓▓▓▓▓ 100              │
 *   │   吐槽欲 ▓▓░░░░ 43               │
 *   │                                   │
 *   │      「今天可以慢慢来」           │  ← 气泡（中文引号 + 居中）
 *   └──────────────────────────────────┘
 */

import { Memo } from "../types";
import { getCurrentLocale, t } from "../i18n";
import { HatchedBuddy, daysSinceHatch } from "./hatch";
import { SPECIES, Rarity } from "./species";
import { SPRITES, HAT_RENDERS } from "./sprites";
import { computeStats } from "./stats";
import { computeStage, STAGE_KEY } from "./stage";

const RARITY_LABELS: Record<Rarity, string> = {
  common: "★",
  uncommon: "★★",
  rare: "★★★",
  epic: "★★★★",
  legendary: "★★★★★",
};

const RARITY_KEY: Record<Rarity, string> = {
  common: "buddy.rarity.common",
  uncommon: "buddy.rarity.uncommon",
  rare: "buddy.rarity.rare",
  epic: "buddy.rarity.epic",
  legendary: "buddy.rarity.legendary",
};

/** 把 sprite + 眼睛 + 帽子 + shiny 组合成最终的 ASCII */
export function composeSprite(buddy: HatchedBuddy): string[] {
  const baseLines = SPRITES[buddy.species].split("\n");

  // 1) 替换眼睛符号（如果不是默认的话）
  //    sprite 源码里有多种眼睛符号（× / ° / @ / ◉ ...），我们统一替换为用户的 eye
  //    用一个简单规则：找到第一行里"括号 + 内部字符 + 括号"模式的字符替换
  //    现实里 sprite 各异，这里宽松替换：把已知眼睛字符全部替换成用户的
  let lines = baseLines;
  const knownEyes = ["·", "✦", "×", "◉", "@", "°", "x", "X"];
  // 不替换默认就是 · 的 sprite —— 简化：只在 buddy.eye 不等于默认的时候才换
  // 默认基线：我们假设 sprite 的"眼睛"在 sprite art 里多半是 °、× 或 ·
  // 这里只在用户 eye 是非默认时才尝试替换，保留视觉风险
  if (buddy.eye !== "·") {
    lines = lines.map((line, idx) => {
      // 只处理"看起来像眼睛行"的：包含成对相同符号
      if (idx >= 2) return line; // 一般眼睛在前 2 行
      let modified = line;
      for (const old of knownEyes) {
        if (old === buddy.eye) continue;
        // 把 "old  old" 这种成对眼睛全部替换
        const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        modified = modified.replace(
          new RegExp(`${escaped}([^\\S\\n]+)${escaped}`, "g"),
          `${buddy.eye}$1${buddy.eye}`
        );
      }
      return modified;
    });
  }

  // 2) 叠加帽子在顶部
  if (buddy.hat !== "none") {
    const hatLines = HAT_RENDERS[buddy.hat];
    if (hatLines.length > 0) {
      // 居中对齐到 sprite 第一行宽度的中心
      const spriteW = Math.max(...lines.map((l) => l.length));
      const centered = hatLines.map((h) => {
        const pad = Math.max(0, Math.floor((spriteW - h.length) / 2));
        return " ".repeat(pad) + h;
      });
      lines = [...centered, ...lines];
    }
  }

  return lines;
}

/** 主渲染函数：把宠物视图渲染到 parent 容器
 *  v2.1.0-iter6: quipText 由调用方传入（view 层决定何时换），render 层只负责显示。
 *    这样切换视图 / 筛选笔记这些非实质变化不会刷新气泡。
 *  v2.1.0-iter10: 新增 onRename 回调，由 view 层注入（双击名字触发）。
 *    新增 justHatched 标记，仅在刚孵化的那一次播放破壳动画。
 *
 *  ⚠️ 设计决策：**故意不提供"重置/重抽宠物"功能**。
 *    宠物的外观（物种 / 稀有度 / 帽子 / 眼睛 / shiny）由用户首次起的名字 hash 决定，
 *    一旦孵化就锁死。这是和 Claude Code Buddy 一致的"命中注定"哲学：
 *      可换 = 它只是个皮肤
 *      不可换 = 它是你专属的、独一无二的那一只
 *    名字可以改（毕竟取错了是真痛点），但长什么样不可改。 */
export function renderBuddy(
  parent: HTMLElement,
  buddy: HatchedBuddy,
  memos: Memo[],
  quipText: string,
  callbacks?: {
    onRename?: () => void;
    justHatched?: boolean;
  }
): void {
  const meta = SPECIES[buddy.species];
  const stats = computeStats(buddy, memos);
  const days = daysSinceHatch(buddy.hatchedAt);
  // v2.1.0-iter13: 计算成长阶段（baby / teen / adult）—— 用于头顶气场 + 阶段标签
  const stage = computeStage(days, memos.length);

  const card = parent.createDiv({
    cls: `Motes-buddy Motes-buddy-${buddy.rarity}` +
      ` Motes-buddy-stage-${stage}` +
      (buddy.shiny ? " Motes-buddy-shiny" : "") +
      (callbacks?.justHatched ? " is-just-hatched" : ""),
  });

  // ===== 顶栏：左 [稀有度 · 阶段 + ✨] / 右 [陪伴天数] =====
  // v2.1.0-iter15: 阶段标签从名字行移到顶栏，与稀有度聚类成"身份信息"。
  //   左侧：★ 普通 · 成年    右侧：陪你 421 天
  // v2.1.0-iter16: 顶栏改为 hover 才显示。设计原因（用户洞察）：
  //   1. "普通"二字时刻提醒价值感低，心理不舒服
  //   2. "成年"阶段一旦达到不再变化，每天看会腻
  //   3. 陪伴天数顺其自然就好，没必要每天看到
  //   平时只看到 ASCII + 名字 + 数据 + 心情，顶栏静静等待"想知道时再看"
  const topbar = card.createDiv({ cls: "Motes-buddy-topbar" });
  const rarityWrap = topbar.createDiv({ cls: "Motes-buddy-rarity-wrap" });
  rarityWrap.createSpan({
    cls: "Motes-buddy-rarity",
    text: `${RARITY_LABELS[buddy.rarity]} ${t(RARITY_KEY[buddy.rarity])}`,
  });
  rarityWrap.createSpan({
    cls: `Motes-buddy-stage Motes-buddy-stage-tag-${stage}`,
    text: ` · ${t(STAGE_KEY[stage])}`,
  });
  if (buddy.shiny) {
    rarityWrap.createSpan({
      cls: "Motes-buddy-shiny-tag",
      text: "✨",
    });
  }
  topbar.createSpan({
    cls: "Motes-buddy-days",
    // v2.1.0-iter10: 首日显示"陪你的第 1 天"而不是"已陪你 0 天"
    //   后者会让用户有"陪伴还没开始"的失落感。
    // 英文界面空间更紧，hover 顶栏用紧凑的 1 day / 60 days，避免换成两行。
    text: getCurrentLocale() === "en-US"
      ? (days <= 1 ? "1 day" : `${days} days`)
      : days === 0
        ? t("buddy.daysCompanion.first")
        : t("buddy.daysCompanion", { n: days }),
  });

  // ===== ASCII 精灵 =====
  //   v2.1.0-iter13: 少年 / 成年阶段，sprite 周围加"气场"装饰元素
  //     - 少年：头顶 ✦ ✦（gentle-float 浮动）
  //     - 成年：头顶 ✦ ✦ + 底部 ┈┈┈┈┈ 光晕（gentle-pulse 呼吸）
  const spriteWrap = card.createDiv({ cls: "Motes-buddy-sprite-wrap" });
  if (stage === "teen" || stage === "adult") {
    spriteWrap.createDiv({
      cls: "Motes-buddy-aura Motes-buddy-aura-top",
      text: "✦ ✦",
    });
  }
  const spriteLines = composeSprite(buddy);
  const sprite = spriteWrap.createDiv({ cls: "Motes-buddy-sprite" });
  sprite.setText(spriteLines.join("\n"));
  if (stage === "adult") {
    spriteWrap.createDiv({
      cls: "Motes-buddy-aura Motes-buddy-aura-bottom",
      text: "┈┈┈┈┈┈┈",
    });
  }

  // ===== 名字行：名字 · 物种 =====
  // v2.1.0-iter10: 双击名字进入内联重命名模式
  // v2.1.0-iter15: 移除阶段标签（移到顶栏与稀有度聚类）+ 移除 Motto 独立行
  //   Motto 收进"物种"的 hover title 里 —— 平时少一行视觉信息，
  //   鼠标好奇时才浮出，更像"和宠物熟悉之后才知道的小秘密"
  const nameRow = card.createDiv({ cls: "Motes-buddy-name-row" });
  const nameSpan = nameRow.createSpan({
    cls: "Motes-buddy-name",
    text: buddy.name,
  });
  nameSpan.setAttr("title", t("buddy.rename.tip"));
  if (callbacks?.onRename) {
    nameSpan.addClass("is-clickable");
    // v2.1.0-iter18: 双击重命名 —— 移动端 dblclick 不可靠（系统缩放手势会截获），
    //   但重命名是低频操作，可接受"移动端无此功能"。
    //   未来若有用户反馈，可以加 long-press 检测作为移动端 fallback。
    nameSpan.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      callbacks.onRename!();
    });
  }
  const speciesSpan = nameRow.createSpan({
    cls: "Motes-buddy-species",
    text: ` · ${t(meta.nameKey)}`,
  });
  // v2.1.0-iter15: Motto 隐藏到物种 hover 里（人格感保留，但不抢视觉）
  speciesSpan.setAttr("title", `「${t(meta.mottoKey)}」`);

  // ===== 5 维属性条 =====
  const statsBox = card.createDiv({ cls: "Motes-buddy-stats" });
  renderStat(statsBox, "DEBUGGING", t("buddy.stat.debugging"), stats.debugging);
  renderStat(statsBox, "PATIENCE", t("buddy.stat.patience"), stats.patience);
  renderStat(statsBox, "CHAOS", t("buddy.stat.chaos"), stats.chaos);
  renderStat(statsBox, "WISDOM", t("buddy.stat.wisdom"), stats.wisdom);
  renderStat(statsBox, "SNARK", t("buddy.stat.snark"), stats.snark);

  // ===== 气泡（情境文案，文案由调用方传入；v2.1.0-iter6 不再在此计算） =====
  if (quipText) {
    const bubble = card.createDiv({ cls: "Motes-buddy-bubble" });
    bubble.createSpan({ cls: "Motes-buddy-bubble-text", text: quipText });
  }
}

function renderStat(
  parent: HTMLElement,
  rawKey: string,
  label: string,
  value: number
): void {
  const row = parent.createDiv({ cls: "Motes-buddy-stat-row" });
  // v2.1.0-iter3: 加 hover tooltip 解释每个属性怎么算的
  const tooltips: Record<string, string> = {
    DEBUGGING: t("buddy.stat.tip.debugging"),
    PATIENCE: t("buddy.stat.tip.patience"),
    CHAOS: t("buddy.stat.tip.chaos"),
    WISDOM: t("buddy.stat.tip.wisdom"),
    SNARK: t("buddy.stat.tip.snark"),
  };
  const tip = tooltips[rawKey] || "";
  const labelSpan = row.createSpan({
    cls: "Motes-buddy-stat-label",
    text: label,
  });
  if (tip) labelSpan.setAttr("title", tip);
  const barWrap = row.createSpan({ cls: "Motes-buddy-stat-bar" });
  if (tip) barWrap.setAttr("title", tip);
  const fill = barWrap.createSpan({ cls: "Motes-buddy-stat-fill" });
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  row.createSpan({ cls: "Motes-buddy-stat-val", text: String(value) });
}

/** 渲染"还没孵化"的占位（蛋 + 起名输入框 + 孵化按钮）
 *  v2.1.0-iter10: 蛋的眼睛会随用户输入变化 —— 没输入时是 ?  ?，
 *  开始输入后变 ✦  ✦（"快出来了"的暗示），增加孵化的仪式感 */
export function renderEgg(
  parent: HTMLElement,
  onHatch: (name: string) => void
): void {
  const egg = parent.createDiv({ cls: "Motes-buddy Motes-buddy-egg" });
  const spriteEl = egg.createDiv({ cls: "Motes-buddy-sprite" });
  const setEggSprite = (eyes: string) => {
    spriteEl.setText(
      "   .---.\n" +
      "  /     \\\n" +
      ` |  ${eyes[0]}  ${eyes[1]} |\n` +
      "  \\_____/"
    );
  };
  setEggSprite("??");
  egg.createDiv({
    cls: "Motes-buddy-egg-title",
    text: t("buddy.egg.title"),
  });
  egg.createDiv({
    cls: "Motes-buddy-egg-desc",
    text: t("buddy.egg.desc"),
  });
  const input = egg.createEl("input", {
    cls: "Motes-buddy-egg-input",
    attr: {
      type: "text",
      placeholder: t("buddy.egg.placeholder"),
      maxlength: "20",
    },
  });
  // v2.1.0-iter10: 输入有值 → 蛋眼睛变 ✦✦，没值 → 回到 ??
  input.addEventListener("input", () => {
    if (input.value.trim()) {
      setEggSprite("✦✦");
      egg.addClass("is-ready");
    } else {
      setEggSprite("??");
      egg.removeClass("is-ready");
    }
  });
  const btn = egg.createEl("button", {
    cls: "Motes-buddy-egg-btn",
    text: t("buddy.egg.hatchBtn"),
  });

  // v2.1.0-iter10: 孵化按钮点击防抖（点了第一次后立刻 disable，避免双击触发两次）
  let hatching = false;
  const submit = () => {
    if (hatching) return;
    const v = input.value.trim();
    if (!v) {
      input.focus();
      input.classList.add("is-error");
      window.setTimeout(() => input.classList.remove("is-error"), 600);
      return;
    }
    hatching = true;
    btn.setAttr("disabled", "true");
    onHatch(v);
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  window.setTimeout(() => input.focus(), 50);
}



