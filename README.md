# 小说生成器 Android

面向安卓手机的 AI 小说创作工具。以书籍、章节和消息为主线，结合角色、动作、世界设定与写作提示，完成正文、摘要、角色成长和续写走向的生成。

**当前版本：1.19（测试版）** · 支持 Android 8.0 及以上 · [下载 APK](https://github.com/xiaohuangya617/novel-writer-android/releases/download/1.19/1.19-NovelGenerator.apk) · [查看历次发布](https://github.com/xiaohuangya617/novel-writer-android/releases)

## 快速开始

1. 安装 APK。首次打开时选择“新建书籍”或“从存档恢复”。恢复仅接受此前由本 App 导出的项目 JSON。
2. 打开侧边栏“AI设置”，填写自己的 API Key，确认 API 地址与模型，然后点击“测试”。默认地址是 DeepSeek 的聊天补全接口，默认模型名为 `deepseek-flash`；可改用兼容接口。
3. 按需建立全局动作资料、全局角色模板和本书角色。全局角色可以逐个导入书籍，导入后与模板独立。
4. 在“设定”和“提示”页填写世界观、大纲、全局提示词及行文规范；在“消息”页输入本章要求并发送。
5. 等待正文、摘要及角色成长整理完成，再到“正文”页阅读。续写按钮会先给出三条走向，选中后回填编辑框，由你决定何时发送。

调用费用由你的 API 服务商收取。App 会在生成结果的消息中显示费用估算；估算值不等于服务商账单。

## 功能

| 范围 | 当前能力 |
| --- | --- |
| 作品管理 | 多书籍书架、章节列表、新建与删除书籍、消息历史、最近一次消息回填与草稿清空。 |
| 创作资料 | 全局设定库保存动作资料；全局角色库可编辑、删除并逐个导入本书角色库；本书角色成长按章节维护。 |
| 创作链 | 长期提示与设定、角色和动作资料、近期成长、本次指令与前文共同参与正文生成；随后整理摘要与角色成长。 |
| 续写 | 固定提供“主动攻略”“被动转折”“女主视角”三种走向；选择结果只回填消息编辑框。 |
| 阅读 | Markdown 正文、跨章节连续全屏阅读；正文和消息字号分别在 12～30px 调节，默认 20px 和 16px。 |
| 任务控制 | 生成期间显示等待状态，可停止；失败后保留指令并提供相应重试入口，应用未关闭时可接续后台任务。 |
| 文件 | 导出或分享项目 JSON、恢复本 App 存档、导出当前书籍的 TXT 正文。 |

## 存档与更新

- 项目存档包含作品、章节、角色、动作和 App 设置，**不包含 API Key**。Key 由 Android Keystore 加密保存在本机。
- 恢复项目存档会**完全覆盖** App 现有资料，操作前建议先导出当前项目。App 导出的项目可交给 PC 端继续编辑；PC 端完整存档含手机端不支持的资料，不能反向直接导入本 App。
- 当前 APK 使用调试签名，适合测试。正式分发前需要稳定的发布签名；签名证书变更会影响覆盖安装。更新前请导出项目存档。
- 目前通过 [GitHub Releases](https://github.com/xiaohuangya617/novel-writer-android/releases) 手动下载新包。**App 内检查、下载和安装更新尚未实现。**

## 构建与测试

需要 JDK 17、Android SDK 35、Gradle 8.9；仓库未附带 Gradle Wrapper。配置 `JAVA_HOME` 和 `ANDROID_HOME` 后运行：

```powershell
gradle assembleDebug
```

APK 输出在 `app/build/outputs/apk/debug/`。浏览器回归需要 Node.js 18+ 及本机 Edge 或 Chromium：

```powershell
npm install
npm test
```

浏览器不在测试默认路径时，通过 `PLAYWRIGHT_BROWSER_PATH` 指定。不要向仓库提交真实 API Key、签名密钥或 `local.properties`。

主要代码位于 `app/src/main/assets/index.html`（界面与交互）、`app/src/main/assets/novel-core.js`（创作请求与资料整理）和 `app/src/main/java/com/novelwriter/mobile/`（Android 网络、文件及本地安全存储）。

## 更新历史

| 版本 | 主要变化 |
| --- | --- |
| **1.19** | 消息字号默认 16px、正文字号默认 20px；“当前版本”浮窗加入公开源码链接。 |
| **1.18** | 侧边栏调整，新增独立消息字号；恢复存档入口改为绿色。 |
| **1.17** | 角色成长折叠卡压缩为固定高度，优化侧边栏名称。 |
| **1.16** | 新增全局角色库、逐个导入本书角色和正文字号调节。 |
| **1.15** | 摘要未完成时提供继续创作方案，补充未保存表单提醒，优化 Markdown 正文阅读。 |
| **1.14** | 首次打开可新建或恢复；阅读模式不保存章内滚动位置。 |
| **1.13** | 采用当前的版本号规则；此版无功能变动。 |

## 开源许可

本项目原创代码采用 [MIT License](LICENSE)。随包使用的 Font Awesome 和 markdown-it 保留各自的许可证，见 `app/src/main/assets/FONT-AWESOME-LICENSE.txt` 与 `app/src/main/assets/MARKDOWN-IT-LICENSE.txt`。仓库不包含原版 PC 软件。
