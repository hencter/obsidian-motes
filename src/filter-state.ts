// ================= 共享筛选状态 =================
// 供 MemoriaView（主视图）和 MemoriaSidebarView（独立侧栏）之间同步筛选

export interface Filter {
  tag: string | null;
  year: string | null;
  date: string | null;
  keyword: string;
  preset:
    | "all"
    | "today"
    | "week"
    | "random"
    | "on-this-day"
    | "no-tag"
    | "with-image"
    | "with-link"
    | "pinned"
    | "starred"
    | "todo";
  randomSeed?: number;
}

const DEFAULT_FILTER: Filter = {
  tag: null,
  year: null,
  date: null,
  keyword: "",
  preset: "all",
};

let state: Filter = { ...DEFAULT_FILTER };
let listeners: Array<() => void> = [];

export function getFilter(): Filter {
  return state;
}

export function setFilter(patch: Partial<Filter> & { reset?: boolean }): void {
  if (patch.reset) {
    state = { ...DEFAULT_FILTER };
  } else {
    Object.assign(state, patch);
  }
  for (const cb of listeners) cb();
}

export function onFilterChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
