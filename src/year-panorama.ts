// ================= 年度全景日历视图 =================
// v1.4.5 新增：12 个月完整日历铺开，每天标记是否有记录
// 点击某天可以跳回主视图并筛选到那一天

import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { MemoStore } from "./store";
import { VIEW_TYPE_Motes_YEAR, VIEW_TYPE_Motes } from "./types";
import { MotesView } from "./view";
import { t } from "./i18n";

/** 星期几简称，走 i18n（中: 日一二三四五六 / 英: SMTWTFS） */
function weekdayShort(dow: number): string {
  return t(`year.weekdayShort.${dow}`);
}

export class YearPanoramaView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private displayYear: number;

  constructor(leaf: WorkspaceLeaf, private store: MemoStore) {
    super(leaf);
    this.displayYear = new Date().getFullYear();
  }

  getViewType(): string {
    return VIEW_TYPE_Motes_YEAR;
  }
  getDisplayText(): string {
    return t("year.viewTitle");
  }
  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.render();
    // 数据变了重绘（用户在 Motes 主视图记录笔记后，这里也要同步高亮）
    this.unsubscribe = this.store.onChange(() => this.render());
  }

  async onClose(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }


  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("Motes-year-view");

    // 统计每天笔记数
    const dayMap = new Map<string, number>();
    for (const m of this.store.getAll()) {
      dayMap.set(m.date, (dayMap.get(m.date) ?? 0) + 1);
    }

    // ========== 顶栏：年份（左） + 切换（右） ==========
    const header = container.createDiv({ cls: "Motes-year-header" });
    header.createDiv({
      cls: "Motes-year-title",
      text: String(this.displayYear),
    });

    const nav = header.createDiv({ cls: "Motes-year-nav" });
    const prevBtn = nav.createEl("button", {
      cls: "Motes-year-nav-btn",
      attr: { "aria-label": t("stats.nav.prevYear") },
    });
    setIcon(prevBtn, "chevron-left");
    prevBtn.addEventListener("click", () => { this.displayYear--; this.render(); });

    const todayYear = new Date().getFullYear();
    if (this.displayYear !== todayYear) {
      const todayBtn = nav.createEl("button", {
        cls: "Motes-year-today-btn",
        text: t("year.thisYear"),
      });
      todayBtn.addEventListener("click", () => {
        this.displayYear = todayYear;
        this.render();
      });
    }

    const nextBtn = nav.createEl("button", {
      cls: "Motes-year-nav-btn",
      attr: { "aria-label": t("stats.nav.nextYear") },
    });
    setIcon(nextBtn, "chevron-right");
    nextBtn.addEventListener("click", () => { this.displayYear++; this.render(); });

    // 各月统计
    const monthlyCounts: number[] = Array(12).fill(0);
    for (const m of this.store.getAll()) {
      if (!m.date.startsWith(`${this.displayYear}-`)) continue;
      const mi = parseInt(m.date.substring(5, 7), 10) - 1;
      monthlyCounts[mi]++;
    }

    const grid = container.createDiv({ cls: "Motes-year-grid" });
    const today = new Date();
    const todayStr = fmtDate(today);
    const thisMonth = today.getFullYear() === this.displayYear ? today.getMonth() : -1;

    let yearCount = 0;
    for (let month = 0; month < 12; month++) {
      const monthEl = grid.createDiv({
        cls: "Motes-year-month" + (month === thisMonth ? " is-current" : ""),
      });

      // 月份标签行（可点击跳当月首日）
      const lblRow = monthEl.createDiv({ cls: "Motes-year-month-label" });
      const mnNum = formatMonth(month, this.displayYear);
      lblRow.createSpan({ text: t("year.monthName", { m: month + 1 }) });
      if (monthlyCounts[month] > 0) {
        const badge = lblRow.createSpan({ cls: "Motes-year-month-count" });
        badge.setText(String(monthlyCounts[month]));
      }
      lblRow.addEventListener("click", () => {
        void this.jumpToDate(mnNum);
      });
      lblRow.setAttr("title", t("year.monthClick"));

      // 星期头（v2.0.4: 走 i18n）
      const weekHead = monthEl.createDiv({ cls: "Motes-year-weekhead" });
      for (let i = 0; i < 7; i++) {
        weekHead.createDiv({ cls: "Motes-year-wday", text: weekdayShort(i) });
      }

      // 日期网格：显示整个 6 周网格（含上月尾 & 下月头，颜色灰显）
      const cal = monthEl.createDiv({ cls: "Motes-year-grid-days" });
      const firstDayOfMonth = new Date(this.displayYear, month, 1);
      const startDow = firstDayOfMonth.getDay(); // 0=日
      const daysInMonth = new Date(
        this.displayYear,
        month + 1,
        0
      ).getDate();
      // 上月末尾，用来填前置空格（显示为灰色数字）
      const daysInPrevMonth = new Date(this.displayYear, month, 0).getDate();

      // 总是渲染 6 行 × 7 列 = 42 格，保证所有月份高度一致
      for (let i = 0; i < 42; i++) {
        let dayNum: number;
        let realDate: Date;
        let isOut = false;
        if (i < startDow) {
          dayNum = daysInPrevMonth - (startDow - 1 - i);
          realDate = new Date(this.displayYear, month - 1, dayNum);
          isOut = true;
        } else if (i < startDow + daysInMonth) {
          dayNum = i - startDow + 1;
          realDate = new Date(this.displayYear, month, dayNum);
        } else {
          dayNum = i - startDow - daysInMonth + 1;
          realDate = new Date(this.displayYear, month + 1, dayNum);
          isOut = true;
        }

        const key = fmtDate(realDate);
        const count = dayMap.get(key) ?? 0;
        // 本月内有笔记的才计入年度统计
        if (!isOut && count > 0) yearCount += count;

        // v1.4.8: 按笔记数分 4 档颜色（1 / 2-3 / 4-6 / 7+），与侧栏热力图一致
        let levelCls = "";
        if (!isOut && count > 0) {
          const lvl =
            count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4;
          levelCls = ` level-${lvl}`;
        }

        const cell = cal.createDiv({
          cls:
            "Motes-year-day" +
            (isOut ? " is-out" : "") +
            (!isOut && count > 0 ? " has-memo" : "") +
            levelCls +
            (key === todayStr ? " is-today" : ""),
          text: String(dayNum),
        });
        if (!isOut && count > 0) {
          cell.setAttr("aria-label", t("year.dayHover", { date: key, n: count }));
          cell.addEventListener("click", () => {
            void this.jumpToDate(key);
          });
        } else if (!isOut) {
          cell.setAttr("aria-label", key);
        }
      }
    }

    // ========== 底部：年度小统计 ==========
    const foot = container.createDiv({ cls: "Motes-year-foot" });
    const activeDays = Array.from(dayMap.keys()).filter((d) =>
      d.startsWith(String(this.displayYear) + "-")
    ).length;
    foot.createSpan({
      cls: "Motes-year-foot-item",
      text: t("year.yearSum", { year: this.displayYear, n: yearCount }),
    });
    foot.createSpan({ cls: "Motes-year-foot-sep", text: "·" });
    foot.createSpan({
      cls: "Motes-year-foot-item",
      text: t("year.activeDays", { n: activeDays }),
    });
  }

  /** 点击某天：打开 Motes 主视图并筛选到那一天的笔记。
   *  v1.4.8: 从"设搜索框值"改为调 MotesView.focusOnDate()，
   *    因为搜索框只匹配 memo.content，对 memo.date 无效；走 focusOnDate 能复用
   *    侧栏月历点日期的同一套 filter.date 机制，才能真正筛出该日笔记。
   */
  private async jumpToDate(date: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_Motes);
    let leaf = leaves[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: VIEW_TYPE_Motes,
        active: true,
      });
    }
    await this.app.workspace.revealLeaf(leaf);

    const view = leaf.view;
    if (view instanceof MotesView) {
      view.focusOnDate(date);
    }
  }
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonth(month: number, year: number): string {
  return `${year}-${(month + 1).toString().padStart(2, "0")}-01`;
}
