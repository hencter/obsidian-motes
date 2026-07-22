/**
 * v2.1.0: 18 种宠物 ASCII 精灵数据
 *
 * ASCII art adapted from Claude Code Buddy (Anthropic, 2026 Aprilfool release).
 * Original source: claude-code v2.1.88 npm leak, buddy/sprites.ts
 *
 * 我们做了 Motes 化的适配：
 *   - 不抄袭逻辑代码，只复刻视觉资源
 *   - 5 维属性、文案池、孵化流程全部原创
 *   - 致敬式移植，README 中明确标注来源
 */

export type SpeciesId =
  | "duck" | "goose" | "blob" | "cat"
  | "dragon" | "octopus" | "owl" | "penguin"
  | "turtle" | "snail" | "ghost" | "axolotl"
  | "capybara" | "cactus" | "robot" | "rabbit"
  | "chonk" | "mushroom";

/** 18 种 ASCII 精灵基础形态。
 *  每只都是 4-5 行高、最大宽度 ≤ 14 字符的紧凑布局，便于侧栏渲染。 */
export const SPRITES: Record<SpeciesId, string> = {
  // ===== Common（普通，60% 概率） =====
  cactus: `n  ____  n
| |°  °| |
|_|    |_|
  |    |`,

  capybara: ` n______n
( ×    × )
(   Oo   )
 \`------´`,

  chonk: ` /\\    /\\
( ×    × )
(   ..   )
 \`------´`,

  snail: `°    .--.
 \\  ( @ )
  \\_\`--´
 ~~~~~~~`,

  // ===== Uncommon（罕见，25% 概率） =====
  cat: `  /\\_/\\
 ( ×  × )
 (  ω  )
 (")_(")`,

  blob: ` .----.
( °  ° )
(      )
 \`----´`,

  duck: `   __
 <(- )___
  (  ._>
   \`--´`,

  turtle: `   _,--._
  ( ·  · )
 /[______]\\
  \`\`    \`\``,

  // ===== Rare（稀有，10% 概率） =====
  rabbit: ` (\\__/)
( ◉  ◉ )
=(  ..  )=
 (")__(")`,

  goose: `   (°>
    ||
  _(__)_
   ^^^^`,

  mushroom: `. o  .
.-o-OO-o-.
(________)
  |°  °|
  |____|`,

  penguin: `  .---.
 (×>×)
/(   )\\
  \`---´`,

  // ===== Epic（史诗，4% 概率） =====
  axolotl: `  \\^^^/
}~(______)~{
}~(× .. ×)~{
  ( .--. )
  (_/  \\_)`,

  robot: `  .[||].
 [ ×  × ]
 [ ==== ]
  \`------´`,

  octopus: ` .----.
( °  ° )
(______)
/\\/\\/\\/\\`,

  // ===== Legendary（传说，1% 概率） =====
  owl: `  /\\  /\\
 ((@)(@))
 (  ><  )
  \`----´`,

  dragon: ` /^\\  /^\\
<  °  °  >
(   ~~   )
 \`-vvvv-´`,

  ghost: ` .----.
( °  ° )
~\`~\`\`~\`~`,
};

/** 6 种眼睛样式。模块化时可以替换 sprite 中的眼睛符号 */
export const EYE_VARIANTS = ["·", "✦", "×", "◉", "@", "°"] as const;
export type EyeVariant = typeof EYE_VARIANTS[number];

/** 8 种帽子（id 索引到下面 HAT_RENDERS 的渲染规则） */
export const HAT_VARIANTS = [
  "none",      // 无帽子
  "crown",     // 👑 皇冠
  "tophat",    // 🎩 礼帽
  "propeller", // 🚁 螺旋桨帽
  "halo",      // 😇 光环
  "wizard",    // 🧙 巫师帽
  "beanie",    // 🧶 毛线帽
  "duckling",  // 🦆 小鸭子（顶在头上）
] as const;
export type HatVariant = typeof HAT_VARIANTS[number];

/** 帽子的 ASCII 渲染（叠在 sprite 顶部一行）
 *  设计原则：每个帽子最多 1-2 行，居中对齐到 sprite 第一行的中心。
 *  实际渲染时由 customize.ts 处理"叠加 + 对齐"。 */
export const HAT_RENDERS: Record<HatVariant, string[]> = {
  none: [],
  crown:     ["__|__"],
  tophat:    ["[___]", "  |  "],
  propeller: ["~+~", " | "],
  halo:      [" ___ ", "(   )"],
  wizard:    ["  /\\", " /  \\", "/----\\"],
  beanie:    [" ___ ", "(\\__/)"],
  duckling:  ["(°<"],
};
