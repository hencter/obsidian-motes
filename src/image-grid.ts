// ================= 图片网格渲染 =================
// 把笔记内容中的所有图片引用（![[...]] 或 ![](...)）提取出来，
// 用朋友圈/浮墨式九宫格布局单独渲染。
// 同时返回剥离掉图片的文本，让 Markdown 渲染器只渲染文字。

import { App, TFile } from "obsidian";
import { t } from "./i18n";

export interface ExtractResult {
  /** 剥离图片后的纯文本（保留其他 markdown） */
  text: string;
  /** 提取出的图片 src 列表（已转换为可访问的 URL） */
  images: ImageRef[];
}

export interface ImageRef {
  /** 在 vault 里的相对路径（wikilink 时） */
  vaultPath?: string;
  /** 最终 <img src="..."> 用的 URL */
  src: string;
  /** alt 文本，用于无障碍 */
  alt: string;
}

const RE_WIKI_IMG = /!\[\[([^\]]+?)(?:\|([^\]]*))?\]\]/g;
const RE_MD_IMG = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 判断扩展名是不是图片 */
function isImageExt(ext: string): boolean {
  return /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(ext);
}

/**
 * 从内容里提取所有图片引用
 */
export function extractImages(
  app: App,
  content: string,
  sourceFile: string
): ExtractResult {
  const images: ImageRef[] = [];

  // 1) ![[xxx.png]] 风格
  let stripped = content.replace(RE_WIKI_IMG, (_full, link: string, alt?: string) => {
    const trimmed = link.trim();
    const ext = (trimmed.split(".").pop() ?? "").toLowerCase();
    if (!isImageExt(ext)) return _full; // 不是图片就保留原样（可能是嵌入笔记）

    const file = app.metadataCache.getFirstLinkpathDest(trimmed, sourceFile);
    if (!(file instanceof TFile)) {
      // 找不到文件，保留原文以便用户感知
      return _full;
    }
    const src = app.vault.getResourcePath(file);
    images.push({ vaultPath: file.path, src, alt: alt ?? file.basename });
    return ""; // 从文本中剥离
  });

  // 2) ![alt](url) 风格
  stripped = stripped.replace(RE_MD_IMG, (_full, alt: string, url: string) => {
    const u = url.trim();
    // 仅当 URL 看起来是图片时才剥离
    const ext = u.split(/[?#]/)[0].split(".").pop() ?? "";
    if (!isImageExt(ext) && !u.startsWith("data:image/")) {
      return _full;
    }
    let src = u;
    // 相对 vault 的路径也尝试转
    if (!u.startsWith("http") && !u.startsWith("data:")) {
      const file = app.metadataCache.getFirstLinkpathDest(u, sourceFile);
      if (file instanceof TFile) {
        src = app.vault.getResourcePath(file);
      }
    }
    images.push({ src, alt: alt || "image" });
    return "";
  });

  // 清理因剥离造成的多余空行
  const text = stripped
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, images };
}

/**
 * 渲染图片网格到 parent 容器
 */
export function renderImageGrid(
  parent: HTMLElement,
  images: ImageRef[],
  onZoom: (index: number) => void
): void {
  if (images.length === 0) return;

  const grid = parent.createDiv({
    cls: `Motes-img-grid Motes-img-grid-${Math.min(images.length, 9)}`,
  });

  // 最多显示 9 张，多余用 +N 蒙版
  const display = images.slice(0, 9);
  display.forEach((img, idx) => {
    const cell = grid.createDiv({ cls: "Motes-img-cell" });
    const el = cell.createEl("img", {
      cls: "Motes-img",
      attr: {
        src: img.src,
        alt: img.alt,
        loading: "lazy",
      },
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onZoom(idx);
    });
    // 最后一格 & 还有更多
    if (idx === 8 && images.length > 9) {
      const overlay = cell.createDiv({ cls: "Motes-img-overlay" });
      overlay.setText(`+${images.length - 9}`);
      overlay.addEventListener("click", (e) => {
        e.stopPropagation();
        onZoom(8);
      });
    }
  });
}

/**
 * 弹出 lightbox 放大查看图片
 */
export function openLightbox(images: ImageRef[], startIndex: number): void {
  let cur = startIndex;
  const backdrop = activeDocument.body.createDiv({ cls: "Motes-lightbox" });
  const stage = backdrop.createDiv({ cls: "Motes-lightbox-stage" });
  const imgEl = stage.createEl("img", { cls: "Motes-lightbox-img" });
  const counter = backdrop.createDiv({ cls: "Motes-lightbox-counter" });

  const closeBtn = backdrop.createEl("button", {
    cls: "Motes-lightbox-close",
    text: "×",
    attr: { "aria-label": t("lightbox.close") },
  });

  const prevBtn = backdrop.createEl("button", {
    cls: "Motes-lightbox-nav Motes-lightbox-prev",
    text: "‹",
    attr: { "aria-label": t("lightbox.prev") },
  });
  const nextBtn = backdrop.createEl("button", {
    cls: "Motes-lightbox-nav Motes-lightbox-next",
    text: "›",
    attr: { "aria-label": t("lightbox.next") },
  });

  const update = () => {
    imgEl.src = images[cur].src;
    imgEl.alt = images[cur].alt;
    counter.setText(`${cur + 1} / ${images.length}`);
    prevBtn.style.visibility = cur > 0 ? "visible" : "hidden";
    nextBtn.style.visibility = cur < images.length - 1 ? "visible" : "hidden";
  };
  update();

  const close = () => {
    backdrop.remove();
    activeDocument.removeEventListener("keydown", onKey);
  };
  const prev = () => {
    if (cur > 0) {
      cur--;
      update();
    }
  };
  const next = () => {
    if (cur < images.length - 1) {
      cur++;
      update();
    }
  };

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    prev();
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    next();
  });
  // 点击背景关闭，但点图片不关
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target === stage) close();
  });
  imgEl.addEventListener("click", (e) => {
    e.stopPropagation();
    next();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "ArrowRight") next();
  };
  activeDocument.addEventListener("keydown", onKey);
}
