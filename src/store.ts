// ================= 数据存储层 =================
// 负责从 vault 读取 md 文件 -> 解析成 memos
// 追加新 memo、删除、编辑、置顶/收藏
// v3.0.0: 存储方式改为日记格式 YYYY-MM-DD.md（每篇为独立天文件）

import { App, TFile, normalizePath } from "obsidian";
import { Memo, MotesSettings, PIN_TAG, STAR_TAG } from "./types";
import {
  parseFile,
  renderMemo,
  fmtDate,
  fmtTime,
  fmtWeekday,
} from "./parser";
import { t } from "./i18n";

export class MemoStore {
  private memos: Memo[] = [];
  private listeners: Array<() => void> = [];
  private loading = false;
  private reloadLocks = new Map<string, { running: boolean; pending: boolean }>();

  constructor(private app: App, private settings: MotesSettings) {}

  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== cb);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  notifyChange(): void {
    this.emit();
  }

  getAll(): Memo[] {
    return this.memos;
  }

  async reloadAll(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const files = this.collectFiles();
      const parsed = await Promise.all(
        files.map(async (f) => {
          const raw = await this.app.vault.read(f);
          return parseFile(f.path, raw);
        })
      );
      const result: Memo[] = [];
      for (const arr of parsed) result.push(...arr);
      this.sortMemos(result);
      this.memos = result;
      this.emit();
    } finally {
      this.loading = false;
    }
  }

  async reloadFile(file: TFile): Promise<void> {
    if (!this.isInFolder(file)) return;
    const key = file.path;
    const existing = this.reloadLocks.get(key);
    if (existing && existing.running) {
      existing.pending = true;
      return;
    }
    const state = { running: true, pending: false };
    this.reloadLocks.set(key, state);
    try {
      do {
        state.pending = false;
        const current = this.app.vault.getAbstractFileByPath(key);
        if (!(current instanceof TFile)) break;
        const raw = await this.app.vault.read(current);
        const fresh = parseFile(current.path, raw);
        this.memos = this.memos.filter((m) => m.file !== current.path);
        this.memos.push(...fresh);
        this.sortMemos(this.memos);
        this.emit();
      } while (state.pending);
    } finally {
      this.reloadLocks.delete(key);
    }
  }

  removeFile(path: string): void {
    const before = this.memos.length;
    this.memos = this.memos.filter((m) => m.file !== path);
    if (this.memos.length !== before) this.emit();
  }

  private sortMemos(arr: Memo[]): void {
    arr.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const dt = b.datetime.getTime() - a.datetime.getTime();
      if (dt !== 0) return dt;
      if (a.file !== b.file) return a.file < b.file ? 1 : -1;
      return b.range[0] - a.range[0];
    });
  }

  private collectFiles(): TFile[] {
    const folder = normalizePath(this.settings.folder);
    return this.app.vault.getMarkdownFiles().filter((f) => {
      const p = f.path;
      if (f.name.startsWith("_")) return false;
      return p === `${folder}/${f.name}` || p.startsWith(`${folder}/`);
    });
  }

  isInFolder(file: TFile): boolean {
    const folder = normalizePath(this.settings.folder);
    if (file.name.startsWith("_")) return false;
    return file.path.startsWith(`${folder}/`);
  }

  /** 创建一条新 memo */
  async addMemo(content: string, when: Date = new Date()): Promise<void> {
    content = content.trim();
    if (!content) return;

    const dateStr = fmtDate(when);
    const timeStr = fmtTime(when);
    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);

    if (this.settings.storageMode === "yearly") {
      await this.addMemoYearly(folder, when, dateStr, timeStr, content);
    } else {
      await this.addMemoDaily(folder, dateStr, timeStr, content);
    }
  }

  private async addMemoDaily(
    folder: string,
    dateStr: string,
    timeStr: string,
    content: string
  ): Promise<void> {
    const filePath = `${folder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) {
      await this.app.vault.create(filePath, renderMemo(timeStr, content) + "\n");
    } else {
      const raw = await this.app.vault.read(file);
      const next = this.insertMemoIntoDay(raw, timeStr, content);
      await this.app.vault.modify(file, next);
    }
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) await this.reloadFile(f);
  }

  private async addMemoYearly(
    folder: string,
    when: Date,
    dateStr: string,
    timeStr: string,
    content: string
  ): Promise<void> {
    const year = when.getFullYear().toString();
    const weekday = fmtWeekday(when);
    const filePath = `${folder}/${year}.md`;
    const file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (!file) {
      const initial = `# ${year}\n\n## ${dateStr} ${weekday}\n\n${renderMemo(
        timeStr,
        content
      )}\n\n`;
      await this.app.vault.create(filePath, initial);
    } else {
      const raw = await this.app.vault.read(file);
      const next = this.insertMemoIntoYear(
        raw,
        year,
        dateStr,
        weekday,
        timeStr,
        content
      );
      await this.app.vault.modify(file, next);
    }
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) await this.reloadFile(f);
  }

  /** 编辑一条 memo（在原文件中原地修改） */
  async editMemo(memo: Memo, newContent: string): Promise<void> {
    newContent = newContent.trim();
    if (!newContent) return;
    const file = this.app.vault.getAbstractFileByPath(memo.file) as TFile | null;
    if (!file) return;
    const raw = await this.app.vault.read(file);
    const lines = raw.split(/\r?\n/);

    const [s0, e0] = memo.range;
    const memoHeadRe = new RegExp(`^-\\s+${memo.time}(?:\\s|$)`);
    let s = s0;
    let e = e0;
    const headOk = s0 >= 0 && s0 < lines.length && memoHeadRe.test(lines[s0]);

    if (!headOk) {
      const fresh = parseFile(file.path, raw);
      const candidates = fresh.filter(
        (m) =>
          m.date === memo.date &&
          m.time === memo.time &&
          m.content === memo.content
      );
      if (candidates.length === 0) {
        throw new Error(t("error.fileChanged"));
      }
      candidates.sort((a, b) => {
        const da = Math.abs(a.range[0] - s0);
        const db = Math.abs(b.range[0] - s0);
        if (da !== db) return da - db;
        return a.range[0] - b.range[0];
      });
      [s, e] = candidates[0].range;
    }

    const rendered = renderMemo(memo.time, newContent).split("\n");
    lines.splice(s, e - s + 1, ...rendered);
    await this.app.vault.modify(file, lines.join("\n"));
    await this.reloadFile(file);
  }

  /** 修改 memo 时间/日期，可同时修改正文。日期变了就搬到对应日记文件。 */
  async editMemoDateTime(
    memo: Memo,
    newDateTime: Date,
    newContent?: string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(memo.file) as TFile | null;
    if (!file) {
      throw new Error(t("error.originNotFound"));
    }

    const content = (newContent ?? memo.content).trim();
    if (!content) {
      throw new Error(t("error.emptyContent"));
    }

    const newDate = fmtDate(newDateTime);
    const newTime = fmtTime(newDateTime);

    if (newDate === memo.date && newTime === memo.time && content === memo.content) {
      return;
    }

    const oldRaw = await this.app.vault.read(file);
    const oldLines = oldRaw.split(/\r?\n/);

    const [s0, e0] = memo.range;
    const memoHeadRe = new RegExp(`^-\\s+${memo.time}(?:\\s|$)`);
    let s = s0;
    let e = e0;
    if (!(s0 >= 0 && s0 < oldLines.length && memoHeadRe.test(oldLines[s0]))) {
      const fresh = parseFile(file.path, oldRaw);
      const candidates = fresh.filter(
        (m) =>
          m.date === memo.date &&
          m.time === memo.time &&
          m.content === memo.content
      );
      if (candidates.length === 0) {
        throw new Error(t("error.fileChanged"));
      }
      candidates.sort((a, b) => {
        const da = Math.abs(a.range[0] - s0);
        const db = Math.abs(b.range[0] - s0);
        if (da !== db) return da - db;
        return a.range[0] - b.range[0];
      });
      [s, e] = candidates[0].range;
    }

    oldLines.splice(s, e - s + 1);

    const cleaned: string[] = [];
    let blank = 0;
    for (const ln of oldLines) {
      if (ln.trim() === "") {
        blank++;
        if (blank <= 2) cleaned.push(ln);
      } else {
        blank = 0;
        cleaned.push(ln);
      }
    }
    // 删除后文件为空（只剩空行）则直接删文件
    if (cleaned.every((ln) => ln.trim() === "")) {
      await this.app.vault.delete(file);
    } else {
      await this.app.vault.modify(file, cleaned.join("\n"));
    }

    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);

    if (this.settings.storageMode === "yearly") {
      const newYear = newDateTime.getFullYear().toString();
      const newWeekday = fmtWeekday(newDateTime);
      const newFilePath = `${folder}/${newYear}.md`;
      await this.insertIntoTargetYearly(
        file, newFilePath, cleaned, newYear, newDate, newWeekday, newTime, content
      );
    } else {
      const newFilePath = `${folder}/${newDate}.md`;
      await this.insertIntoTargetDaily(file, newFilePath, cleaned, newTime, content);
    }
  }

  private async insertIntoTargetDaily(
    oldFile: TFile,
    newFilePath: string,
    cleaned: string[],
    newTime: string,
    content: string
  ): Promise<void> {
    const sameFile = newFilePath === oldFile.path;
    if (sameFile && !cleaned.every((ln) => ln.trim() === "")) {
      const refreshed = await this.app.vault.read(oldFile);
      const next = this.insertMemoIntoDay(refreshed, newTime, content);
      await this.app.vault.modify(oldFile, next);
      await this.reloadFile(oldFile);
    } else {
      const target = this.app.vault.getAbstractFileByPath(newFilePath) as TFile | null;
      if (!target) {
        await this.app.vault.create(newFilePath, renderMemo(newTime, content) + "\n");
      } else {
        const targetRaw = await this.app.vault.read(target);
        const next = this.insertMemoIntoDay(targetRaw, newTime, content);
        await this.app.vault.modify(target, next);
      }
      if (oldFile.path !== newFilePath || !sameFile) {
        if (!cleaned.every((ln) => ln.trim() === "")) {
          await this.reloadFile(oldFile);
        }
      }
      const newFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile | null;
      if (newFile) await this.reloadFile(newFile);
    }
  }

  private async insertIntoTargetYearly(
    oldFile: TFile,
    newFilePath: string,
    cleaned: string[],
    newYear: string,
    newDate: string,
    newWeekday: string,
    newTime: string,
    content: string
  ): Promise<void> {
    const sameFile = newFilePath === oldFile.path;
    if (sameFile && !cleaned.every((ln) => ln.trim() === "")) {
      const refreshed = await this.app.vault.read(oldFile);
      const next = this.insertMemoIntoYear(refreshed, newYear, newDate, newWeekday, newTime, content);
      await this.app.vault.modify(oldFile, next);
      await this.reloadFile(oldFile);
    } else {
      const target = this.app.vault.getAbstractFileByPath(newFilePath) as TFile | null;
      if (!target) {
        const initial = `# ${newYear}\n\n## ${newDate} ${newWeekday}\n\n${renderMemo(newTime, content)}\n\n`;
        await this.app.vault.create(newFilePath, initial);
      } else {
        const targetRaw = await this.app.vault.read(target);
        const next = this.insertMemoIntoYear(targetRaw, newYear, newDate, newWeekday, newTime, content);
        await this.app.vault.modify(target, next);
      }
      if (oldFile.path !== newFilePath || !sameFile) {
        if (!cleaned.every((ln) => ln.trim() === "")) {
          await this.reloadFile(oldFile);
        }
      }
      const newFile = this.app.vault.getAbstractFileByPath(newFilePath) as TFile | null;
      if (newFile) await this.reloadFile(newFile);
    }
  }

  /** 删除 memo */
  async deleteMemo(memo: Memo): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(memo.file) as TFile | null;
    if (!file) return;

    if (this.settings.useTrash) {
      try {
        await this.appendToTrash(memo);
      } catch (err) {
        console.error("[Motes] 写入回收站失败（将继续执行删除）:", err);
      }
    }

    const raw = await this.app.vault.read(file);
    const lines = raw.split(/\r?\n/);
    const [s, e] = memo.range;
    lines.splice(s, e - s + 1);

    const isYearly = this.settings.storageMode === "yearly";
    if (isYearly) {
      this.removeOrphanDateHeaders(lines);
    }

    const cleaned: string[] = [];
    let blank = 0;
    for (const ln of lines) {
      if (ln.trim() === "") {
        blank++;
        if (blank <= (isYearly ? 2 : 1)) cleaned.push(ln);
      } else {
        blank = 0;
        cleaned.push(ln);
      }
    }
    while (cleaned.length && cleaned[cleaned.length - 1].trim() === "") {
      cleaned.pop();
    }
    while (cleaned.length && cleaned[0].trim() === "") {
      cleaned.shift();
    }

    if (cleaned.length === 0) {
      await this.app.vault.delete(file);
    } else {
      await this.app.vault.modify(file, cleaned.join("\n"));
    }
    await this.reloadFile(file);
  }

  /**
   * v1.1.9: 把一条 memo 追加到 `<folder>/_trash.md`。
   *
   * 格式：每条带来源注释 + 原时间 + 原内容，方便将来人肉恢复：
   *   ## 已删除 2026-05-04 01:30
   *   - 来源：Motes/2026.md · 原时间 2026-04-25 12:43
   *     <原 memo 内容>
   *
   * 注意：_trash.md 没有 `# YYYY` 头、也不按日期分组，避免被 parseFile 误识别成正常 memo；
   *       也不放在 Motes 文件夹之外，因为用户停用插件后依然能在同一文件夹里看到它。
   */
  private async appendToTrash(memo: Memo): Promise<void> {
    const folder = normalizePath(this.settings.folder);
    await this.ensureFolder(folder);
    const trashPath = `${folder}/_trash.md`;

    const now = new Date();
    const delStamp = `${fmtDate(now)} ${fmtTime(now)}`;
    // 内容前缀加 2 空格缩进，与 memo 渲染风格一致
    const indented = memo.content
      .split("\n")
      .map((l) => (l === "" ? "" : `  ${l}`))
      .join("\n");

    const block =
      `\n## 已删除 ${delStamp}\n\n` +
      `- 来源：\`${memo.file}\` · 原时间 ${memo.date} ${memo.time}\n` +
      `${indented}\n`;

    const existing = this.app.vault.getAbstractFileByPath(trashPath) as
      | TFile
      | null;
    if (!existing) {
      const header =
        `# Motes 回收站\n\n` +
        `> 这里保存被删除的笔记。停用插件后依然可读，可手动恢复或清空。\n` +
        `> 该文件不会被 Motes 主视图识别为普通笔记。\n`;
      await this.app.vault.create(trashPath, header + block);
    } else {
      const old = await this.app.vault.read(existing);
      // v1.4.3: 先拼接新块，再按上限裁剪最旧的条目（FIFO 滚动）。
      //   这样 _trash.md 不会随时间无限膨胀；上限由 settings.trashMaxItems 控制，
      //   0 表示不限制。
      const merged = old + block;
      const trimmed = this.trimTrashToLimit(
        merged,
        this.settings.trashMaxItems
      );
      await this.app.vault.modify(existing, trimmed);
    }
  }

  /**
   * v1.4.3: 把 _trash.md 内容裁剪到最多 limit 条（保留最新的），
   *         返回裁剪后的完整文本。limit <= 0 表示不裁剪。
   *
   *   逻辑：以 `## 已删除 ...` 行作为每条记录的分界，切成 N 条；
   *         如果 N > limit，则丢掉最前面 N-limit 条，保留最新的 limit 条。
   *         文件头的说明块（`# Motes 回收站` 及其 > 引用）永远保留。
   */
  private trimTrashToLimit(raw: string, limit: number): string {
    if (!limit || limit <= 0) return raw;

    const lines = raw.split(/\r?\n/);
    const delHeaderRe = /^##\s+已删除\s+/;

    // 找到所有 "## 已删除 ..." 行的行号
    const headerIdxs: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (delHeaderRe.test(lines[i])) headerIdxs.push(i);
    }
    if (headerIdxs.length <= limit) return raw;

    // 保留最新的 limit 条 => 从第 (N - limit) 条开始保留
    const keepFromIdx = headerIdxs[headerIdxs.length - limit];
    // 文件头：保留从开头到第一条 "## 已删除" 之前的所有内容
    const headEndIdx = headerIdxs[0];
    const headPart = lines.slice(0, headEndIdx);
    const keptPart = lines.slice(keepFromIdx);
    // 拼回时在文件头和首条保留记录间保证恰好一个空行
    while (headPart.length && headPart[headPart.length - 1].trim() === "") {
      headPart.pop();
    }
    return headPart.join("\n") + "\n\n" + keptPart.join("\n");
  }

  /**
   * 原地移除所有"空日期标题"：
   *   ## 2025-06-28 周六     <- 下方没有任何 - HH:MM 行的标题将被删除
   */
  private removeOrphanDateHeaders(lines: string[]): void {
    const dateRe = /^##\s+\d{4}-\d{2}-\d{2}(?:\s+.+)?$/;
    const memoRe = /^- \d{2}:\d{2}/;
    const nextBlockRe = /^#{1,2}\s+/;

    // 从后往前扫，遇到日期标题就检查它到下一个 header 之间有没有 memo
    const toDelete: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!dateRe.test(lines[i])) continue;
      let hasMemo = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (nextBlockRe.test(lines[j])) break;
        if (memoRe.test(lines[j])) {
          hasMemo = true;
          break;
        }
      }
      if (!hasMemo) toDelete.push(i);
    }
    // 从后往前删，避免 index 错位
    for (let k = toDelete.length - 1; k >= 0; k--) {
      lines.splice(toDelete[k], 1);
    }
  }

  /** 切换置顶（追加/移除 #置顶 标签） */
  async togglePinned(memo: Memo): Promise<void> {
    await this.toggleReservedTag(memo, PIN_TAG);
  }

  /** 切换收藏（追加/移除 #收藏 标签） */
  async toggleStarred(memo: Memo): Promise<void> {
    await this.toggleReservedTag(memo, STAR_TAG);
  }

  private async toggleReservedTag(memo: Memo, tag: string): Promise<void> {
    const has = memo.tags.includes(tag);
    let newContent: string;
    if (has) {
      // 移除所有出现的 #tag（含前缀空白）
      const re = new RegExp(
        `\\s*#${escapeRegex(tag)}(?![A-Za-z0-9_\\u4e00-\\u9fff/])`,
        "g"
      );
      newContent = memo.content.replace(re, "");
      newContent = newContent
        .split("\n")
        .map((l) => l.replace(/[ \t]+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // Bug fix (v1.1.2): 若去完后整条笔记什么都不剩，
      //   之前用 " "（单空格）占位会被 renderMemo 写成一条"内容为空格"的诡异笔记，
      //   严重时还会让这条 memo 在 UI 上彻底消失（stripTags 后文本为空 + 无图 + 无标签）。
      //   现在的策略：直接"退化为"一条只有原标签的占位内容，保证笔记可见、可再编辑；
      //   真正想彻底删除 memo 应该走"删除"菜单，而不是通过取消置顶/收藏隐式删除。
      if (newContent === "") {
        newContent = `（已取消${tag}）`;
      }
    } else {
      // 追加到**首行末尾**，确保 renderMemo 后 #tag 在 "- HH:MM XXX #tag" 行上
      // 这样后续 parser 解析时一定能通过 extractTags 识别出来
      const lines = memo.content.split("\n");
      if (lines.length === 0 || lines[0].trim() === "") {
        lines[0] = `#${tag}`;
      } else {
        lines[0] = `${lines[0].replace(/\s+$/, "")} #${tag}`;
      }
      newContent = lines.join("\n");
      // 注意：这里 **不** 调用 trim()，因为那会把内容末尾的图片块换行吃掉，
      // 不影响内容但可能影响 parser 的行号范围一致性
    }
    await this.editMemo(memo, newContent);
  }

  /**
   * 保存二进制图片到附件目录
   * 文件名：Motes-YYYYMMDD-HHmmss-随机.<ext>
   */
  async saveImageAttachment(
    bytes: ArrayBuffer,
    extension: string
  ): Promise<string> {
    const folder = normalizePath(this.settings.attachmentFolder);
    await this.ensureFolder(folder);
    const now = new Date();
    const stamp =
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds());
    const rand = Math.random().toString(36).slice(2, 6);
    const ext = (extension || "png").replace(/^\./, "").toLowerCase();
    const path = `${folder}/Motes-${stamp}-${rand}.${ext}`;
    await this.app.vault.createBinary(path, bytes);
    return path;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const exists = this.app.vault.getAbstractFileByPath(folder);
    if (!exists) {
      await this.app.vault.createFolder(folder);
    }
  }

  /** 年模式：将 memo 按时间和日期升序插入到 raw 文本 */
  private insertMemoIntoYear(
    raw: string,
    year: string,
    date: string,
    weekday: string,
    time: string,
    content: string
  ): string {
    const lines = raw.split(/\r?\n/);
    const yearHeader = `# ${year}`;
    const dateHeader = `## ${date} ${weekday}`;
    const memoBlock = renderMemo(time, content);

    let yearLine = lines.findIndex((l) => l.trim() === yearHeader);
    if (yearLine < 0) {
      if (lines.length && lines[0].trim() !== "") {
        lines.unshift("", yearHeader, "");
      } else {
        lines.unshift(yearHeader, "");
      }
      yearLine = lines.findIndex((l) => l.trim() === yearHeader);
    }

    const dateRe = new RegExp(`^##\\s+${date}(?:\\s+.+)?$`);
    const dateLine = lines.findIndex((l) => dateRe.test(l));

    if (dateLine >= 0) {
      let end = lines.length;
      for (let i = dateLine + 1; i < lines.length; i++) {
        if (/^#{1,2}\s+/.test(lines[i])) { end = i; break; }
      }
      const timeRe = /^-\s+(\d{2}:\d{2})(?:\s|$)/;
      let insertBeforeIdx = -1;
      for (let i = dateLine + 1; i < end; i++) {
        const tm = lines[i].match(timeRe);
        if (tm && tm[1] > time) { insertBeforeIdx = i; break; }
      }
      if (insertBeforeIdx >= 0) {
        let at = insertBeforeIdx;
        while (at > dateLine + 1 && lines[at - 1].trim() === "") at--;
        lines.splice(at, 0, memoBlock, "");
        return lines.join("\n");
      }
      const insertAt = this.trimTrailingBlank(lines, dateLine + 1, end);
      lines.splice(insertAt, 0, "", memoBlock);
      return lines.join("\n");
    }

    const allDateRe = /^##\s+(\d{4}-\d{2}-\d{2})/;
    const nextYearRe = /^#\s+\d{4}\s*$/;
    let insertIdx = -1;
    let scanEnd = lines.length;
    for (let i = yearLine + 1; i < lines.length; i++) {
      if (nextYearRe.test(lines[i])) { scanEnd = i; break; }
    }
    for (let i = yearLine + 1; i < scanEnd; i++) {
      const m = lines[i].match(allDateRe);
      if (m && m[1] > date) { insertIdx = i; break; }
    }

    if (insertIdx === -1) {
      if (scanEnd < lines.length) {
        let endOfYear = scanEnd;
        while (endOfYear > yearLine + 1 && lines[endOfYear - 1].trim() === "") endOfYear--;
        const block = [dateHeader, "", memoBlock, ""];
        lines.splice(endOfYear, 0, "", ...block);
        return lines.join("\n");
      }
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", dateHeader, "", memoBlock, "");
      return lines.join("\n");
    }

    const block = ["", dateHeader, "", memoBlock, ""];
    lines.splice(insertIdx, 0, ...block);
    return lines.join("\n");
  }

  private trimTrailingBlank(lines: string[], from: number, to: number): number {
    let last = from;
    for (let i = from; i < to; i++) {
      if (lines[i].trim() !== "") last = i + 1;
    }
    return last;
  }

  /** 日记模式：将 memo 按时间升序插入到 raw 文本 */
  private insertMemoIntoDay(raw: string, time: string, content: string): string {
    const lines = raw.split(/\r?\n/);
    const memoBlock = renderMemo(time, content);
    const timeRe = /^-\s+(\d{2}:\d{2})(?:\s|$)/;
    const memoHeadRe = /^-\s+\d{2}:\d{2}/;

    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const tm = lines[i].match(timeRe);
      if (tm && tm[1] > time) {
        // 向上退回前导空行
        let at = i;
        while (at > 0 && lines[at - 1].trim() === "") at--;
        insertIdx = at;
        break;
      }
    }

    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, memoBlock, "");
    } else {
      // 追加到末尾
      let last = lines.length;
      while (last > 0 && lines[last - 1].trim() === "") last--;
      if (last < lines.length) lines.splice(last);
      lines.push("", memoBlock);
    }
    return lines.join("\n");
  }

  /** 迁移：将日记格式 (YYYY-MM-DD.md) 合并到年格式 (YYYY.md) */
  async migrateDailyToYearly(): Promise<{ merged: number; deleted: number; errors: number }> {
    const folder = normalizePath(this.settings.folder);
    const dayRe = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
    const dayFiles = this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(`${folder}/`) && dayRe.test(f.name)
    );

    let merged = 0;
    let deleted = 0;
    let errors = 0;

    for (const dayFile of dayFiles) {
      try {
        const raw = await this.app.vault.read(dayFile);
        const memos = parseFile(dayFile.path, raw);
        if (memos.length === 0) {
          await this.app.vault.delete(dayFile);
          deleted++;
          continue;
        }

        const year = dayFile.name.match(dayRe)![1];
        const yearPath = `${folder}/${year}.md`;
        const yearFile = this.app.vault.getAbstractFileByPath(yearPath) as TFile | null;

        let yearRaw: string;
        if (yearFile) {
          yearRaw = await this.app.vault.read(yearFile);
        } else {
          yearRaw = `# ${year}\n`;
        }

        // 按日期分组，逐条插入
        const byDate = new Map<string, { date: string; weekday: string; time: string; content: string }[]>();
        for (const m of memos) {
          const w = fmtWeekday(m.datetime);
          const key = m.date;
          if (!byDate.has(key)) byDate.set(key, []);
          byDate.get(key)!.push({ date: m.date, weekday: w, time: m.time, content: m.content });
        }

        for (const [date, items] of byDate) {
          for (const item of items) {
            yearRaw = this.insertMemoIntoYear(yearRaw, year, item.date, item.weekday, item.time, item.content);
            merged++;
          }
        }

        if (yearFile) {
          await this.app.vault.modify(yearFile, yearRaw);
        } else {
          await this.app.vault.create(yearPath, yearRaw);
        }

        await this.app.vault.delete(dayFile);
        deleted++;
      } catch (err) {
        console.error(`[Motes] Migration failed for ${dayFile.path}:`, err);
        errors++;
      }
    }

    await this.reloadAll();
    return { merged, deleted, errors };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
