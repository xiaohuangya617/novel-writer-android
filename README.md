# 小说生成器 Android

一个面向手机的 AI 小说创作 App。用户可以管理书籍与章节、维护角色和动作资料、编写设定与提示词，通过自备的 API 生成正文、章节摘要、角色成长和三条续写走向。

## 下载与使用

安装包放在 GitHub Releases。首次打开后新建书籍，或从此前由本 App 导出的项目存档恢复；随后在侧边栏“设置”中填写 API 地址、API Key 和模型并测试连接。默认地址为 DeepSeek 兼容的聊天补全接口，模型名称可自行修改。API 调用产生的费用由用户自己的服务商账户承担。

App 可导出项目 JSON 供 PC 端继续编辑，也可导出当前书籍的 TXT 正文。PC 端完整存档包含 App 尚不支持的资料，因此 App 只接受自身导出的项目存档。项目存档不包含 API Key；Key 在 Android Keystore 中加密保存在本机。

## 主要功能

- 多书籍、章节列表与消息式创作流程。
- 本书角色库、全局角色模板逐个导入、动作资料库和角色成长记录。
- 小说设定、写作提示、三条固定架构的续写走向。
- 普通阅读与跨章节连续阅读、正文字号调节。
- 后台生成接续、停止与失败重试、费用估算。
- 项目存档导出、分享与恢复，以及本书正文 TXT 导出。

## 构建

需要 JDK 17、Android SDK 35 和 Gradle 8.9。配置好 `JAVA_HOME` 与 `ANDROID_HOME` 后，在本目录运行：

```powershell
gradle assembleDebug
```

调试 APK 位于 `app/build/outputs/apk/debug/`。已发布的 APK 使用调试签名，适合当前测试阶段；正式分发前应配置专用发布签名。请勿将签名密钥、`local.properties` 或真实 API Key 提交到仓库。

浏览器回归检查使用 Node.js 18+、`npm install` 和本机的 Edge/Chromium：

```powershell
npm test
```

浏览器不在测试默认路径时，可用 `PLAYWRIGHT_BROWSER_PATH` 指定可执行文件。

## 项目结构

- `app/src/main/assets/index.html`：手机界面与交互。
- `app/src/main/assets/novel-core.js`：创作请求组包、摘要及成长解析。
- `app/src/main/java/com/novelwriter/mobile/`：Android 文件、网络任务和本地加密存储。
- `tests/smoke.js`：核心流程的浏览器回归。

第三方 Markdown 与图标资源的许可文本保留在 `app/src/main/assets/`。本仓库目前未声明整体开源许可证。
