# Kasa-xuexitong-helper (v1.4.0)

支持 **超星学习通** 与 **知到智慧树（Zhihuishu）** 双平台的课程学习与作业考试辅助脚本。

## 核心功能

### 超星学习通
- **音视频播放**：严格保持 `1.0x` 原速静音播放，切屏或失焦暂停后经拟人延时自动恢复。
- **文档浏览**：自动完成课件与文档任务点阅读。
- **章节连播**：当前章节任务点完成后自动进入下一节。
- **作业与测验**：支持单选、多选、判断、填空与简答题解析（内置动态混淆字体还原与多页单题续跑），可对接 OpenAI 兼容接口（DeepSeek、SiliconFlow、OpenAI 等）。

### 知到智慧树
- **视频挂机与连播**：严格保持 `1.0x` 原速静音播放，暂停后拟人延时恢复；支持经典共享课与新版 AI 课程跨章自动展开切换下一未完成视频。
- **随堂弹题自动过关**：自动识别视频中弹出的随堂测试弹窗（含经典弹题与新版 `AI随堂练习` 弹窗及轻提示框），优先调用 AI 解答并支持保底选项兜底，完成后自动关闭弹窗恢复播放。
- **作业与在线考试**：兼容 `stuExamWeb` / `onlineexamh5new` 等页面题型识别、Element UI 单选/多选/输入同步与翻页/保存/暂存/提交；当使用 **Chrome 扩展版** 且遇封闭 `closed Shadow DOM` 题干时，支持零 Hook 后台静默截取题干区域并结合明文选项交由多模态 AI 自动识题。

## 安装使用

1. **油猴脚本方式**：浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)，导入仓库中的 `Kasa-xuexitong-helper.user.js` 或构建产物 `dist/Kasa-xuexitong-helper.user.js`。
2. **Chrome / Edge 扩展版（推荐，支持封闭题干自动视觉识题）**：
   - 若同时安装了油猴版，请先在油猴中禁用同一脚本避免双开冲突。
   - 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`），开启右上角 **开发者模式**，点击 **加载已解压的扩展程序** 并选择本仓库下的 `chrome-extension/` 目录。
   - **重要前提**：
     - 必须在面板「AI 设置」中选用支持图片输入的多模态视觉模型（如 Gemini、GPT-4o / 4o-mini、Qwen-VL 等；纯文本模型无法识别题干截图）。
     - 建议将网课标签页拖拽成**独立浏览器窗口**再作答：同窗口内切到别的标签页会触发隐私保护而跳过截屏；独立窗口则可在后台不被抢焦点（需不点击最小化；若被其他程序完全遮盖时想在后台继续截屏，可在 `chrome://settings/performance` 关闭节能/内存节省模式，并在 Chrome 快捷方式目标末尾添加 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`）。
3. 如需 AI 自动答题，在页面右上角脚本面板的「AI 设置」中填入接口地址与 API Key 并保存（Chrome 扩展版通过 `chrome.storage.local` 跨子域自动同步配置）。

## 本地构建

```bash
npm install
npm run dev
npm run build
npm test
```

## License

[MIT](LICENSE)
