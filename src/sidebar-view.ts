// ================= Motes 独立侧栏视图 =================
// 作为 Obsidian 标准 ItemView，可拖拽、可停靠到侧边栏区域

import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  Notice,
  Platform,
} from "obsidian";
import { Memo, MotesSettings, RESERVED_TAGS, VIEW_TYPE_Motes_SIDEBAR } from "./types";
import { MemoStore } from "./store";
import { fmtDate } from "./parser";
import { renderCalendar } from "./calendar";
import { t } from "./i18n";
import { getFilter, setFilter, onFilterChange, Filter } from "./filter-state";
import { hatch, HatchedBuddy } from "./buddy/hatch";
import { renderBuddy, renderEgg } from "./buddy/render";
import { pickQuip } from "./buddy/quips";

export class MotesSidebarView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private overviewMode: "heatmap" | "calendar" | "buddy" = "heatmap";
  private overviewModeOverridden = false;
  private tagsExpanded = false;
  private buddyQuipCache: string | null = null;
  private buddyLastMemoCount = -1;
  private buddyJustHatched = false;
  private dailyGoalNoticedDate: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private store: MemoStore,
    private settings: MotesSettings,
    private plugin: { saveSettings(): Promise<void> }
  ) {
    super(leaf);
    this.overviewMode = this.settings.defaultOverviewMode || "heatmap";
  }

  getViewType(): string { return VIEW_TYPE_Motes_SIDEBAR; }
  getDisplayText(): string { return t("sidebar.viewTitle"); }
  getIcon(): string { return "panel-left"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("motes-sidebar-view");
    this.unsubscribe = this.store.onChange(() => this.render());
    onFilterChange(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
  }

  private render(): void {
    this.contentEl.empty();
    const memos = this.store.getAll();
    const filter = getFilter();

    // 统计
    const tagSet = new Set<string>();
    const daySet = new Set<string>();
    let imageCount = 0, linkCount = 0, noTagCount = 0;
    let pinnedCount = 0, starredCount = 0, onThisDayCount = 0;
    let todayCount = 0, weekCount = 0, todoCount = 0;
    const todayStr = fmtDate(new Date());
    const todayMMDD = todayStr.slice(5);
    const weekMondayTs = (() => {
      const now = new Date();
      const monday = new Date(now);
      const dow = (now.getDay() + 6) % 7;
      monday.setDate(now.getDate() - dow);
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
    })();

    for (const m of memos) {
      for (const t of m.tags) if (!RESERVED_TAGS.has(t)) tagSet.add(t);
      daySet.add(m.date);
      if (m.hasImage) imageCount++;
      if (m.hasLink) linkCount++;
      if (m.isPinned) pinnedCount++;
      if (m.isStarred) starredCount++;
      if (m.hasOpenTask) todoCount++;
      if (m.date === todayStr) todayCount++;
      if (m.datetime.getTime() >= weekMondayTs) weekCount++;
      if (m.date.slice(5) === todayMMDD && m.date !== todayStr) onThisDayCount++;
      const effective = m.tags.filter((t) => !RESERVED_TAGS.has(t));
      if (effective.length === 0) noTagCount++;
    }

    const stats = this.contentEl.createDiv({ cls: "Motes-stats" });
    this.renderStatItem(stats, memos.length.toString(), t("stats.memos"));
    this.renderStatItem(stats, tagSet.size.toString(), t("stats.tags"));
    this.renderStatItem(stats, daySet.size.toString(), t("stats.days"));

    // 概览区（热力图/月历/宠物）
    this.renderOverview(this.contentEl, memos);
    this.renderDailyGoal(this.contentEl, memos);

    // 视图区
    this.contentEl.createDiv({ cls: "Motes-sidebar-section", text: t("sidebar.section.views") });
    const presets: Array<{ key: Filter["preset"]; icon: string; text: string; count?: number }> = [
      { key: "all", icon: "layout-grid", text: t("sidebar.all"), count: memos.length },
      { key: "pinned", icon: "pin", text: t("sidebar.pinned"), count: pinnedCount },
      { key: "starred", icon: "star", text: t("sidebar.starred"), count: starredCount },
      { key: "today", icon: "calendar", text: t("sidebar.today"), count: todayCount },
      { key: "week", icon: "calendar-days", text: t("sidebar.week"), count: weekCount },
      { key: "todo", icon: "check-square", text: t("sidebar.todo"), count: todoCount },
      { key: "on-this-day", icon: "history", text: t("sidebar.review"), count: onThisDayCount },
    ];
    for (const p of presets) this.renderNavItem(p, filter);

    // 检索式
    this.contentEl.createDiv({ cls: "Motes-sidebar-section", text: t("sidebar.section.search") });
    this.renderNavItem({ key: "no-tag", icon: "tag", text: t("sidebar.noTag"), count: noTagCount }, filter);
    this.renderNavItem({ key: "with-image", icon: "image", text: t("sidebar.withImage"), count: imageCount }, filter);
    this.renderNavItem({ key: "with-link", icon: "link", text: t("sidebar.withLink"), count: linkCount }, filter);

    // 年份
    const yearCount = new Map<string, number>();
    for (const m of memos) yearCount.set(m.date.substring(0, 4), (yearCount.get(m.date.substring(0, 4)) ?? 0) + 1);
    if (this.settings.showSidebarYears && yearCount.size) {
      this.contentEl.createDiv({ cls: "Motes-sidebar-section", text: t("sidebar.section.years") });
      const years = [...yearCount.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1);
      for (const [y, c] of years) {
        const el = this.contentEl.createDiv({ cls: "Motes-nav-item" + (filter.year === y ? " active" : "") });
        const icon = el.createDiv({ cls: "Motes-nav-icon" });
        setIcon(icon, "calendar");
        el.createSpan({ cls: "Motes-nav-text", text: y });
        el.createSpan({ cls: "Motes-nav-count", text: String(c) });
        el.addEventListener("click", () => {
          setFilter({ year: filter.year === y ? null : y, preset: "all" });
        });
      }
    }

    // 标签树
    if (this.settings.showSidebarTags) {
      const tagCount = new Map<string, number>();
      for (const m of memos) for (const t of m.tags) {
        if (RESERVED_TAGS.has(t)) continue;
        tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      }
      if (tagCount.size) {
        const sectionHead = this.contentEl.createDiv({ cls: "Motes-sidebar-section Motes-section-collapsible" });
        sectionHead.createSpan({ cls: "Motes-section-arrow", text: this.tagsExpanded ? "\u25BE" : "\u25B8" });
        sectionHead.createSpan({ text: ` ${t("sidebar.section.tags")} (${tagCount.size})` });
        sectionHead.addEventListener("click", () => {
          this.tagsExpanded = !this.tagsExpanded;
          this.render();
        });
        if (this.tagsExpanded) {
          const tree = this.buildTagTree(tagCount);
          this.renderTagTree(this.contentEl, tree, 0, filter);
        }
      }
    }
  }

  private renderStatItem(parent: HTMLElement, num: string, label: string): void {
    const item = parent.createDiv({ cls: "Motes-stat" });
    item.createDiv({ cls: "Motes-stat-num", text: num });
    item.createDiv({ cls: "Motes-stat-label", text: label });
  }

  private renderNavItem(p: { key: Filter["preset"]; icon: string; text: string; count?: number }, filter: Filter): void {
    const isActive = filter.preset === p.key && !filter.tag && !filter.year;
    const el = this.contentEl.createDiv({ cls: "Motes-nav-item" + (isActive ? " active" : "") });
    const iconEl = el.createDiv({ cls: "Motes-nav-icon" });
    setIcon(iconEl, p.icon);
    el.createSpan({ cls: "Motes-nav-text", text: p.text });
    if (p.count !== undefined) el.createSpan({ cls: "Motes-nav-count", text: String(p.count) });
    el.addEventListener("click", () => {
      setFilter({ preset: p.key, tag: null, year: null, date: null, randomSeed: p.key === "random" ? Date.now() : undefined });
    });
  }

  private renderOverview(parent: HTMLElement, memos: Memo[]): void {
    // v2.0.20: follow defaultOverviewMode
    if (!this.overviewModeOverridden) {
      this.overviewMode = this.settings.defaultOverviewMode || "heatmap";
    }
    const wrap = parent.createDiv({ cls: "Motes-overview" });
    const content = wrap.createDiv({ cls: "Motes-overview-content" });
    if (this.overviewMode === "heatmap") {
      this.renderHeatmap(content, memos);
    } else if (this.overviewMode === "calendar") {
      const filter = getFilter();
      renderCalendar(content, memos, {
        activeDate: filter.date,
        onPickDate: (d) => { setFilter({ date: filter.date === d ? null : d, preset: "all" }); },
      });
    } else {
      this.renderBuddyView(content, memos);
    }
  }

  private renderHeatmap(parent: HTMLElement, memos: Memo[]): void {
    const weeks = 14;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const curDow = today.getDay();
    const endSunday = new Date(today); endSunday.setDate(today.getDate() - curDow);
    const startSunday = new Date(endSunday); startSunday.setDate(endSunday.getDate() - (weeks - 1) * 7);
    const dayMap = new Map<string, number>();
    for (const m of memos) dayMap.set(m.date, (dayMap.get(m.date) ?? 0) + 1);
    const grid = parent.createDiv({ cls: "Motes-heatmap" });
    for (let w = 0; w < weeks; w++) {
      const col = grid.createDiv({ cls: "Motes-heatmap-col" });
      for (let d = 0; d < 7; d++) {
        const day = new Date(startSunday); day.setDate(startSunday.getDate() + w * 7 + d);
        const key = fmtDate(day);
        const count = dayMap.get(key) ?? 0;
        const level = count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4;
        const cell = col.createDiv({ cls: `Motes-heatmap-cell level-${level}` });
        if (day > today) cell.addClass("future");
        if (count > 0) cell.setAttr("aria-label", `${key}: ${count} memos`);
        else cell.setAttr("aria-label", `${key}: 0`);
      }
    }
  }

  private renderDailyGoal(parent: HTMLElement, memos: Memo[]): void {
    const goal = Math.max(1, this.settings.dailyGoal || 5);
    const todayStr = fmtDate(new Date());
    let todayCount = 0;
    for (const m of memos) if (m.date === todayStr) todayCount++;
    const pct = Math.min(100, Math.round((todayCount / goal) * 100));
    const isDone = todayCount >= goal;

    if (isDone && this.dailyGoalNoticedDate !== todayStr) {
      this.dailyGoalNoticedDate = todayStr;
      window.setTimeout(() => { new Notice(t("notice.dailyGoalDone", { n: todayCount })); }, 200);
    }

    const goalTooltip = isDone
      ? t("list.dailyGoalExceed", { goal, done: todayCount, extra: todayCount - goal })
      : t("list.dailyGoalDone", { goal, done: todayCount });

    const row = parent.createDiv({ cls: `Motes-daily-goal-row${isDone ? " is-done" : ""}` });
    const barWrap = row.createDiv({ cls: "Motes-daily-goal", attr: { "aria-label": goalTooltip } });
    barWrap.addEventListener("click", () => { setFilter({ preset: "today", tag: null, date: null }); });
    const bar = barWrap.createDiv({ cls: "Motes-daily-goal-bar" });
    bar.createDiv({ cls: "Motes-daily-goal-fill" }).style.width = `${pct}%`;

    const actions = row.createDiv({ cls: "Motes-daily-goal-actions" });
    const targetBtn = actions.createEl("button", { cls: "Motes-icon-btn Motes-daily-goal-target", attr: { "aria-label": goalTooltip } });
    setIcon(targetBtn, "crosshair");

    const nextMode: "heatmap" | "calendar" | "buddy" = this.overviewMode === "heatmap" ? "calendar" : this.overviewMode === "calendar" ? "buddy" : "heatmap";
    const nextIcon = nextMode === "calendar" ? "calendar" : nextMode === "buddy" ? "paw-print" : "activity";
    const switchBtn = actions.createEl("button", { cls: "Motes-icon-btn Motes-daily-goal-switch", attr: { "aria-label": t(`toolbar.to${nextMode.charAt(0).toUpperCase() + nextMode.slice(1)}`) } });
    setIcon(switchBtn, nextIcon);
    switchBtn.addEventListener("click", () => {
      this.overviewMode = nextMode;
      this.overviewModeOverridden = true;
      this.render();
    });
  }

  private renderBuddyView(parent: HTMLElement, memos: Memo[]): void {
    const data = this.settings.buddy;
    if (!data) {
      renderEgg(parent, (chosenName) => {
        void (async () => {
          const hatched = hatch(this.app.vault.getName(), chosenName);
          this.settings.buddy = {
            species: hatched.species, rarity: hatched.rarity, eye: hatched.eye,
            hat: hatched.hat, shiny: hatched.shiny, name: hatched.name,
            hatchedAt: hatched.hatchedAt, seed: hatched.seed,
          };
          await this.plugin.saveSettings();
          this.buddyJustHatched = true;
          this.render();
        })().catch((err) => { console.error("[Motes] Failed to hatch buddy:", err); });
      });
      return;
    }
    const buddy: HatchedBuddy = {
      species: data.species as HatchedBuddy["species"], rarity: data.rarity as HatchedBuddy["rarity"],
      eye: data.eye as HatchedBuddy["eye"], hat: data.hat as HatchedBuddy["hat"],
      shiny: data.shiny, name: data.name, hatchedAt: data.hatchedAt, seed: data.seed,
    };
    const increased = this.buddyLastMemoCount >= 0 && memos.length > this.buddyLastMemoCount;
    if (this.buddyQuipCache === null || increased) {
      this.buddyQuipCache = pickQuip(buddy, memos);
    }
    this.buddyLastMemoCount = memos.length;
    const justHatched = this.buddyJustHatched;
    this.buddyJustHatched = false;
    renderBuddy(parent, buddy, memos, this.buddyQuipCache, {
      onRename: () => {
        void (async () => {
          const newName = await this.promptAsync(t("buddy.rename.title"), buddy.name);
          if (!newName) return;
          const trimmed = newName.trim();
          if (!trimmed || trimmed === buddy.name) return;
          if (!this.settings.buddy) return;
          this.settings.buddy.name = trimmed.slice(0, 20);
          await this.plugin.saveSettings();
          this.render();
        })();
      },
      justHatched,
    });
  }

  private promptAsync(title: string, defaultValue: string): Promise<string | null> {
    return new Promise((resolve) => {
      const backdrop = activeDocument.body.createDiv({ cls: "Motes-modal-backdrop" });
      const box = backdrop.createDiv({ cls: "Motes-modal Motes-confirm" });
      box.createDiv({ cls: "Motes-modal-title", text: title });
      const input = box.createEl("input", { cls: "Motes-buddy-egg-input", attr: { type: "text", maxlength: "20", value: defaultValue } });
      const btns = box.createDiv({ cls: "Motes-modal-btns" });
      btns.createEl("button", { text: t("buddy.rename.cancel") }).addEventListener("click", () => { backdrop.remove(); resolve(null); });
      btns.createEl("button", { text: t("buddy.rename.save"), cls: "mod-cta" }).addEventListener("click", () => { backdrop.remove(); resolve(input.value); });
      backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
      activeDocument.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { backdrop.remove(); resolve(null); }
        if (e.key === "Enter") { backdrop.remove(); resolve(input.value); }
      }, { once: true });
      window.setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  private buildTagTree(tagCount: Map<string, number>): Map<string, unknown> {
    const root = new Map<string, unknown>();
    for (const [tag, count] of tagCount) {
      const parts = tag.split("/");
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i + 1).join("/");
        if (!node.has(key)) node.set(key, new Map<string, unknown>());
        node = node.get(key) as Map<string, unknown>;
      }
      (node as unknown as Record<string, number>)._count = count;
    }
    return root;
  }

  private renderTagTree(parent: HTMLElement, tree: Map<string, unknown>, depth: number, filter: Filter): void {
    for (const [key, children] of tree) {
      if (key === "_count") continue;
      const map = children as Map<string, unknown>;
      const count = map.get("_count") as number | undefined;
      const active = filter.tag === key;
      const el = parent.createDiv({ cls: "Motes-nav-item Motes-tag-item" + (active ? " active" : "") });
      el.style.paddingLeft = `${12 + depth * 14}px`;
      const icon = el.createDiv({ cls: "Motes-nav-icon" });
      setIcon(icon, "hash");
      const parts = key.split("/");
      el.createSpan({ cls: "Motes-nav-text", text: parts[parts.length - 1] });
      if (count !== undefined) el.createSpan({ cls: "Motes-nav-count", text: String(count) });
      el.addEventListener("click", () => { setFilter({ tag: filter.tag === key ? null : key, preset: "all" }); });
      if (map.size > 1) this.renderTagTree(parent, map, depth + 1, filter);
    }
  }
}
