# 提交 Memoria 到 Obsidian 官方商店 · 操作指南

> 这是给自己看的备忘录（2026-05-06 首次准备）。
>
> 仓库：https://github.com/i-iooi-i/obsidian-memoria
> 商店仓库：https://github.com/obsidianmd/obsidian-releases
> 官方指南：https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins

---

## ✅ 合规清单（提交前逐项自检）

### 代码层

- [x] **License**：MIT（`LICENSE` 文件，含 `Copyright (c) 2026 zololiu`）
- [x] **0 `eval()` / `new Function`**：已扫描确认
- [x] **0 `document.write`**：已扫描确认
- [x] **0 `innerHTML` 写入**：v1.4.15 已改为 DocumentFragment + cloneNode
- [x] **0 外部 CDN 引入**（unpkg/jsdelivr/cdnjs 等）：零依赖，纯 JS
- [x] **0 `XMLHttpRequest`**：没用
- [x] **使用 Obsidian 官方 API**：Plugin / ItemView / WorkspaceLeaf / MarkdownRenderer / Vault / Menu / Notice / setIcon / Platform 全部来自 `obsidian` 包
- [x] **资源清理**：插件 `onunload` 里所有 DOM / listener / 定时器由 `this.register(...)` / `registerEvent(...)` / `childComponent.unload()` 自动清理
- [x] **不修改 Obsidian 核心 API / 全局 prototype**

### manifest.json 完整性

- [x] `id: "memoria"`（小写、kebab-case，不能和现有插件重名）
- [x] `name: "Memoria"`（显示名）
- [x] `version: "1.4.15"`（semver）
- [x] `minAppVersion: "1.4.0"`
- [x] `description`（清晰描述用途，< 250 字符）
- [x] `author: "i-iooi-i"`
- [x] `authorUrl: "https://github.com/i-iooi-i"`（指向作者 GitHub）
- [x] `fundingUrl`（可选，已加）
- [x] `isDesktopOnly: false`（桌面+移动双平台）

### 仓库层

- [x] **Release v1.4.15** 已发布，含 main.js / manifest.json / styles.css 三件套 assets
- [x] **README** 清晰说明插件用途、安装方式、截图
- [x] **CHANGELOG** 详细记录版本历史
- [ ] **仓库 About description**（需手动到 GitHub 填）
- [ ] **Topics** 添加：`obsidian-plugin` `obsidian-md` `memos` `flomo` `blinko` `markdown` `note-taking`

---

## 📝 提交流程

### Step 1. 最后一次 self-review（本地）

```bash
# 在 memoria-release 目录
cd C:\Users\zololiu\Desktop\memoria-release

# 最新的 Release 已发布到 GitHub？
git log --oneline -3
git tag --list | Select-Object -Last 3
# 应该看到 v1.4.15 tag

# 仓库主页核对：
# - README 首屏截图正常显示
# - Release 页面 v1.4.15 三件套可下载
# - About description 和 Topics 已填
```

### Step 2. Fork obsidian-releases

1. 浏览器访问 https://github.com/obsidianmd/obsidian-releases
2. 右上角点 **Fork** → Fork 到自己的 GitHub 账号 `i-iooi-i`

### Step 3. 修改 community-plugins.json

在你的 fork 仓库 `i-iooi-i/obsidian-releases`：

1. 打开 `community-plugins.json`（文件很大，约几千个插件）
2. 在**末尾**数组的最后一项后加逗号，追加：

```json
{
  "id": "memoria",
  "name": "Memoria",
  "author": "i-iooi-i",
  "description": "浮墨式碎片笔记瀑布流，数据永远是纯 Markdown，自由属于你。",
  "repo": "i-iooi-i/obsidian-memoria"
}
```

⚠️ **注意 JSON 格式**：
- 上一项末尾要加逗号
- 你这一项**不要**加末尾逗号
- `repo` 字段只写 `owner/repo`，不要带 `https://github.com/` 前缀

### Step 4. 提交 Pull Request

1. Commit 消息：`Add Memoria plugin`
2. PR 标题：`Add Memoria`
3. PR 描述模板（官方仓库 `.github/PULL_REQUEST_TEMPLATE/plugin.md` 有详细模板，逐条勾选）：

```markdown
# I am submitting a new Community Plugin

## Repo URL

Link to my plugin: https://github.com/i-iooi-i/obsidian-memoria

## Release Checklist

- [x] I have tested the plugin on
  - [x] Windows
  - [x] iOS (iPhone)
- [x] My GitHub release contains all required files
  - [x] `main.js`
  - [x] `manifest.json`
  - [x] `styles.css`
- [x] GitHub release name matches the exact version number specified in my manifest.json (`1.4.15`)
- [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies, and have assessed my plugins's adherence to these policies.
- [x] I have read the tips in https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines and have self-reviewed my plugin to avoid these common pitfalls.
- [x] I have added a license in the LICENSE file.
- [x] My project respects and is compatible with the original license of any code from other plugins that I'm using.
```

### Step 5. 等待审核

- **审核速度**：通常 1-4 周，志愿者审核员有空就看
- **可能的反馈**：
  - "Remove `innerHTML` usage" → 已预先修复 ✓
  - "Use `addEventListener` via `this.register(...)` to auto-cleanup" → 已使用 ✓
  - "Don't use `any` type" → 偶尔提，不是硬性
  - "Add mobile screenshots" → 可以在 PR 评论里补
- **收到 feedback 怎么办**：
  1. 在本地仓库改代码
  2. 发新 Release（比如 v1.4.16）
  3. **不需要改 PR 的 JSON**（`community-plugins.json` 只记 repo，版本号是动态拉取）
  4. 在 PR 评论回复"Fixed in v1.4.16"

### Step 6. 合并后

- Obsidian 每隔几小时从 `community-plugins.json` 同步一次插件列表
- 新插件会在**用户的"浏览社区插件"对话框里**可搜到
- 也会出现在 https://obsidian.md/plugins 官方页面

---

## 🎯 插件版本更新（提交后的后续维护）

合并到商店后，**下次发新版只需**：

1. 源码改 → `publish.ps1` 一键发版 → GitHub Release 三件套
2. **Obsidian 会自动检测到**新 Release（对比 manifest.json 的 version）
3. 用户的 Obsidian "设置 → 社区插件 → 检查更新" 就能看到并点"更新"
4. **完全不需要再向 obsidian-releases 提 PR**

注意：`manifest.json` 的 `minAppVersion` 如果提升，要记得在 Release 里写清楚。

---

## 🚫 常见被拒原因（踩坑记录）

1. **依赖 node_modules / 外部文件**：main.js 必须是单文件打包好的
2. **用 `innerHTML` 拼接带 user input 的 HTML**（我们没有 ✓）
3. **main.js 体积过大**（> 500KB 会被问"为什么这么大"；Memoria ≈ 97KB ✓）
4. **description 里带 emoji 的**（审核员不喜欢；我们没有 ✓）
5. **manifest.json 的 `authorUrl` 指向非作者账号**（我们指向自己 ✓）
6. **README 里没截图**（现在 3 张截图齐全 ✓）

---

## 📚 参考资料

- [Plugin submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
- [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)（进阶，暂不需要）
