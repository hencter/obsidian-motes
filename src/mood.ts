/**
 * v2.0.0: 情感色彩可视化。
 * v2.0.1: 新增 2 个维度（fear 害怕 / tired 疲惫），sad 补"哭泣""崩溃感"等关键词。
 * v2.0.2: 新增 inspired 维度（鼓励/励志/加油）。
 *
 * 设计原则：
 *   - 保守：只在非常确定的情感关键词命中时才着色，否则不染
 *   - 透明：关键词列表暴露在代码里，用户可以看到为什么这条被染色
 *   - 克制：7 种情感维度，覆盖日常记录常见情绪
 *   - 可关：默认关闭（settings.enableMoodColoring = false），用户主动开才启用
 *
 * ⚡ 与 UI 语言的关系：
 *   词库**同时包含中英文关键词，始终都跑**，与 UI 语言无关。
 *   - 英文用户写「So happy today!」→ 命中英文 happy
 *   - 中文用户写「今天好开心」→ 命中中文 happy
 *   - 混用笔记（同条既有中英文）→ 按命中最多的那类决定
 *   这是刻意设计：情感识别不应受 UI 语言限制，用户爱用什么语言写就什么语言写。
 *
 * 视觉表现：卡片左边 3px 宽的颜色条
 *   - 开心 happy    → 金黄色   #f5c76a
 *   - 感动 touched  → 粉色     #e88eb4
 *   - 鼓励 inspired → 橙色     #e89a5c
 *   - 低落 sad      → 蓝灰色   #7a93b0
 *   - 烦躁 angry    → 红褐色   #c77764
 *   - 害怕 fear     → 暗紫色   #6e5a8f
 *   - 疲惫 tired    → 浅灰棕色 #a89684
 *   - 中性          → 不染色（透明）
 *
 * ⚠️ 局限性：基于**关键词词典**的启发式判断，不是 AI。
 *    像「人类的悲欢并不相通」这种隐喻性表达不会触发（关键词里没有"悲""欢"的裸字）。
 *    如果要完美识别需要 LLM 级别语义理解，那会引入隐私/成本/延迟问题。
 *    Motes 保持"关键词"方案，是在"有用"和"克制"间的平衡。
 *
 * 匹配规则：
 *   1. 遍历所有情感类别的关键词，统计每类命中次数
 *   2. 命中次数最多的那一类胜出
 *   3. 并列或 0 命中 → 中性（不染）
 */

export type Mood =
  | "happy"
  | "touched"
  | "inspired"
  | "sad"
  | "angry"
  | "fear"
  | "tired"
  | "neutral";

/** 情感关键词词库（中文 + 英文常用词） */
const MOOD_KEYWORDS: Record<Exclude<Mood, "neutral">, string[]> = {
  happy: [
    "开心", "高兴", "快乐", "欣喜", "兴奋", "爽", "哈哈", "嘻嘻",
    "满足", "幸福", "惊喜", "棒", "太棒", "赞", "好玩", "有意思", "乐",
    "嘿嘿", "哇", "太好了", "真好", "nice", "yyds",
    "happy", "joy", "awesome", "great", "love", "amazing", "wonderful",
    "excited", "yay", "lol", "haha",
  ],
  touched: [
    "感动", "温暖", "暖心", "泪目", "心动", "治愈", "温馨", "感慨",
    "怀念", "想念", "思念", "难忘", "感激", "感谢", "不舍", "眷恋",
    "touched", "moved", "warm", "heartwarming", "nostalgic", "miss", "grateful",
  ],
  // v2.0.2: 新增「鼓励/励志/加油」
  inspired: [
    // 中文
    "加油", "冲", "冲冲冲", "奥利给", "燃起来了", "打鸡血", "动力",
    "坚持", "努力", "不放弃", "突破", "自信", "勇敢", "鼓励", "鼓舞",
    "勇气", "相信自己", "你可以的", "我可以", "拼了", "干了", "撑住",
    "振作", "振奋", "昂扬", "斗志", "力量", "希望", "前进", "向前",
    "成长", "突破自我", "挑战", "出发", "启程", "搞起", "go",
    // 英文
    "inspired", "motivated", "encourage", "encouraged", "brave", "courage",
    "go for it", "you got this", "keep going", "never give up", "let's go",
    "hustle", "grit", "hope",
  ],
  sad: [
    "难过", "伤心", "失落", "低落", "沮丧", "抑郁", "孤独", "寂寞",
    "心碎", "遗憾", "可惜", "后悔", "哭了", "哭泣", "流泪", "泪水",
    "眼泪", "emo", "丧", "悲伤", "悲痛", "哀伤", "心酸", "痛苦",
    "难受", "委屈", "失望", "绝望", "心疼",
    "sad", "lonely", "depressed", "down", "heartbroken", "regret", "cry",
    "crying", "tears", "grief", "sorrow", "miserable",
  ],
  angry: [
    "烦", "烦躁", "愤怒", "生气", "恼火", "无语", "崩溃", "讨厌",
    "郁闷", "抓狂", "气死", "气人", "草", "靠", "卧槽", "气炸",
    "angry", "annoyed", "frustrated", "hate", "ugh", "wtf", "damn", "mad",
  ],
  fear: [
    "害怕", "恐惧", "恐怖", "吓人", "吓死", "吓到", "惊吓", "惊恐",
    "不安", "担忧", "担心", "忐忑", "焦虑", "紧张", "惊慌", "心慌",
    "毛骨悚然", "胆怯", "胆战心惊", "恐慌", "慌乱", "惶恐",
    "afraid", "scared", "fear", "terrifying", "horror", "anxious", "worried",
    "nervous", "panic", "frightened",
  ],
  tired: [
    "累", "好累", "太累", "疲惫", "疲倦", "精疲力尽", "筋疲力尽",
    "困", "困了", "想睡", "没劲", "无力", "倦怠", "困倦", "犯困",
    "乏力", "憔悴", "困得不行",
    "tired", "exhausted", "sleepy", "drained", "worn out", "burnout", "burnt out",
  ],
};

/** 预编译：把关键词转为 RegExp（避免每次 match 都重新构造）
 *  中文关键词不需要词边界；英文关键词加 \b 防止子串误匹配（如 "happen" 不应命中 "happy"） */
const MOOD_REGEXPS: Record<Exclude<Mood, "neutral">, RegExp> = (() => {
  const compile = (keywords: string[]): RegExp => {
    const parts = keywords.map((kw) => {
      // 英文关键词（纯 ASCII）加词边界
      if ([...kw].every((ch) => ch.charCodeAt(0) <= 0x7F)) {
        return `\\b${escapeRegExp(kw)}\\b`;
      }
      // 中文/其他：直接匹配
      return escapeRegExp(kw);
    });
    return new RegExp(parts.join("|"), "gi");
  };
  return {
    happy: compile(MOOD_KEYWORDS.happy),
    touched: compile(MOOD_KEYWORDS.touched),
    inspired: compile(MOOD_KEYWORDS.inspired),
    sad: compile(MOOD_KEYWORDS.sad),
    angry: compile(MOOD_KEYWORDS.angry),
    fear: compile(MOOD_KEYWORDS.fear),
    tired: compile(MOOD_KEYWORDS.tired),
  };
})();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判断一段文本的情感倾向。命中数最多的那类胜出，并列 / 0 命中 → 中性 */
export function detectMood(text: string): Mood {
  if (!text) return "neutral";
  const scores: Record<Exclude<Mood, "neutral">, number> = {
    happy: 0,
    touched: 0,
    inspired: 0,
    sad: 0,
    angry: 0,
    fear: 0,
    tired: 0,
  };
  for (const [mood, re] of Object.entries(MOOD_REGEXPS)) {
    // 重置 lastIndex 避免 /g 正则在同一对象上复用时漏匹配
    re.lastIndex = 0;
    const matches = text.match(re);
    if (matches) {
      scores[mood as Exclude<Mood, "neutral">] = matches.length;
    }
  }
  const entries = Object.entries(scores).sort(
    (a, b) => b[1] - a[1]
  ) as Array<[Exclude<Mood, "neutral">, number]>;
  const top = entries[0];
  const second = entries[1];
  if (top[1] === 0) return "neutral";
  if (top[1] === second[1]) return "neutral"; // 并列不染，避免误判
  return top[0];
}

/** 给 mood 提供 CSS class 名字（view.ts 用这个挂到卡片上） */
export function moodClass(mood: Mood): string {
  return `Motes-mood-${mood}`;
}
