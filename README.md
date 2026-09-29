<p align="center">
  <img src="icon-preview.png" width="128" alt="1.38 小说生成器应用图标" />
</p>

<h1 align="center">1.38 小说生成器 Android</h1>

<p align="center">
  <a href="https://github.com/xiaohuangya617/novel-writer-android/releases"><img src="https://img.shields.io/badge/version-1.38-0f766e.svg" alt="版本 1.38" /></a>
  <a href="https://developer.android.com/about/versions/oreo"><img src="https://img.shields.io/badge/Android-8.0%2B-3ddc84.svg" alt="Android 8.0 及以上" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb.svg" alt="MIT License" /></a>
</p>

一个 Android AI 小说创作工具。本质上是对 DeepSeek 等兼容聊天补全接口的封装：模型负责生成文本，App 负责界面、书籍与章节管理、提示词组装、上下文整理、摘要与角色成长回流、续写作品、走向策略、存档和更新。

**当前版本：1.38（正式版）** · 支持 Android 8.0 及以上 · [下载 APK](https://github.com/xiaohuangya617/novel-writer-android/releases/download/1.38/1.38小说生成器.apk) · [查看历次发布](https://github.com/xiaohuangya617/novel-writer-android/releases)

## 快速开始

1. 安装 APK，首次打开时新建书籍或恢复 App 导出的项目 JSON。
2. 打开“AI 设置”，填写 API 地址、API Key 和模型，点击“测试”。默认使用 DeepSeek 聊天补全接口和 `deepseek-flash`，也支持兼容接口。
3. 填写世界观、主线大纲、写作提示，按需配置角色、动作和服装资料。
4. 在消息框输入本章要求并发送。正文生成后，App 会继续整理摘要和角色成长；“走向”会先给出三条续写方向，选中后再由你决定是否发送。

1.38 是当前正式版。本版隔离续写原作资料的第 0 章，正文从第 1 章开始计数；旧版本 APK 会保留在发布归档中。

API 费用由你填写的服务商收取。App 内的费用只是根据接口用量做的估算。

## 创作链

```mermaid
flowchart LR
    A[设定与资料] --> B[本次创作指令]
    B --> C[调用 AI API 生成正文]
    C --> D[整理摘要与角色成长]
    D --> E[阅读或继续创作]
```

## 主要功能

- **书籍与章节**：多书籍书架、章节列表、消息历史和草稿恢复。
- **创作资料**：世界观、主线大纲、写作提示、角色、动作、服装和全局禁用词。
- **连续创作**：把固定设定、近期成长、本次指令和前文按顺序组装进请求，生成正文后再回写摘要与角色成长。
- **走向分支**：基于当前作品生成三张独立的剧情走向卡片；支持 H/X 策略，选择后只回填输入框，不会未经确认直接生成正文。
- **续写作品**：导入 TXT，自动分章和选取原作范围，分批分析、JSON 校验/修复、融合资料，最后自动创建新书并回填文风、行文规范、世界观、主线和主要角色；失败批次可重试或跳过。原作资料会以“原作：TXT 文件名”保存在新书的资料章节中，不计入正文统计，正文从第 1 章开始。
- **开发者选项**：5 秒内连续点击 7 次解锁（仅当前会话有效），可编辑实际发送给 API 的 12 个固定 Prompt（六条请求链各自的 System/User），支持单项或全部恢复默认。自定义 Prompt 可通过动态占位符继续接收书籍资料，并在所有书籍间共用。恢复、清空等确认操作使用 App 自有浮窗，不调用浏览器原生确认框。
- **阅读与文件**：Markdown 正文、连续阅读、TXT 导出，以及 App/HTML 项目存档导出与恢复。
- **任务与更新**：生成中可停止，失败可重试；支持检查 GitHub 版本、下载并交给系统安装。

## 存档说明

- App 存档用于本 App 恢复，包含书籍、章节、创作资料、字号、走向策略和开发者选项 Prompt；HTML 存档用于把作品资料交给 PC 版继续编辑，不包含 App 专用字号、走向策略和开发者 Prompt。
- 两种存档都不包含 API Key，Key 使用 Android Keystore 加密保存在本机。
- 恢复旧 App 存档时会自动补齐缺少的默认字段和 Prompt；恢复 App 存档会覆盖当前 App 数据，操作前请先导出备份。

## 构建与测试

需要 JDK 17、Android SDK 35 和 Gradle 8.9。仓库未附带 Gradle Wrapper。正式包需要发布签名文件和密码，签名材料不包含在仓库中。

```powershell
gradle assembleDebug

npm install
npm test
```

调试 APK 输出在 `app/build/outputs/apk/debug/`；正式 APK 输出在 `app/build/outputs/apk/release/`。构建正式包前，将密码通过 `NOVEL_RELEASE_PASSWORD` 环境变量提供。不要提交 API Key、签名密钥或 `local.properties`。

主要代码：

- `app/src/main/assets/index.html`：界面与交互
- `app/src/main/assets/novel-core.js`：请求组装与资料整理
- `app/src/main/java/com/novelwriter/mobile/`：Android 网络、文件和安全存储

## 更新历史

| 版本 | 主要变化 |
| --- | --- |
| **1.38** | 隔离续写原作资料的第 0 章；修复章节编号、成长归档和章节统计。 |
| **1.36** | 正式启用增强版走向 System；优化摘要与成长请求的长期资料顺序，改善缓存前缀稳定性。 |
| **1.35** | 优化开发者选项卡片，调整修改、恢复默认和取消编辑后的交互。 |
| **1.34** | 新增开发者选项，可查看、修改和恢复创作链提示词，并支持存档。 |
| **1.33** | 补充使用说明和主线结局约束示例；合并字号设置入口。 |
| **1.32** | 扩展 TXT 章节标题识别，支持序章、楔子、番外和更多数字格式。 |
| **1.31** | 优化续写分析并发、分批和停止处理，修复 TXT 分块与章节识别问题。 |
| **1.30** | 加入 TXT 导入、自动分章、资料分析、融合和自动建书。 |
| **1.29** | 新增 H/X 走向策略、全局禁用词批量管理，并优化走向请求。 |
| **1.28** | 优化角色成长、摘要和服装规则在创作链中的使用。 |
| **1.27** | 新增全局禁用词和 HTML 存档导出，整理 App/HTML 分享流程。 |
| **1.26** | “续写”改名为“走向”，全局角色库改名为“素材角色库”。 |
| **1.25** | 新增全局服装库，并接入正文、续写、摘要和角色成长。 |
| **1.24** | 优化连接测试取消和 GitHub 限流提示。 |
| **1.23** | 优化更新检查、下载取消和下载状态恢复。 |
| **1.22** | 增加角色重名校验，细化更新错误提示。 |
| **1.21** | 重整存档、分享和更新下载入口。 |
| **1.20** | 首个正式版，加入 App 内更新检查、APK 校验和安装确认。 |
| **1.19 及更早** | 持续完善阅读、字号、角色库、存档和首次启动流程。 |

## 开源许可

原创代码采用 [MIT License](LICENSE)。Font Awesome 和 markdown-it 保留各自许可证，见 `app/src/main/assets/FONT-AWESOME-LICENSE.txt` 与 `app/src/main/assets/MARKDOWN-IT-LICENSE.txt`。
