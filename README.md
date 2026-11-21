# Kasa-xuexitong-helper (v1.4.0)

支持 **超星学习通** 与 **知到智慧树（Zhihuishu）** 双平台的课程学习与作业考试辅助脚本。

## 核心功能

### 超星学习通
- **音视频播放**：严格保持 `1.0x` 原速静音播放，切屏或失焦暂停后经拟人延时自动恢复。
- **文档浏览**：自动完成课件与文档任务点阅读。
- **章节连播**：当前章节任务点完成后自动进入下一节。
- **作业与测验**：支持单选、多选、判断、填空与简答题解析（内置动态混淆字体还原与多页单题续跑），可对接 OpenAI 兼容接口（DeepSeek、SiliconFlow、OpenAI 等）。

### 知到智慧树
- **视频挂机与连播**：严格保持 `1.0x` 原速静音播放，暂停后拟人延时恢复；当前视频完播后自动切换目录下一未完成视频。
- **随堂弹题自动过关**：自动识别视频中弹出的随堂测试弹窗（支持单题与多题标签），优先调用 AI 解答并支持保底选项兜底，完成后自动关闭弹窗恢复播放。
- **作业与在线考试**：兼容 `stuExamWeb` / `onlineexamh5new` 等页面题型识别、Element UI 单选/多选/输入同步与翻页/暂存/提交。

## 安装使用

1. **油猴脚本方式**：浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)，导入仓库中的 `Kasa-xuexitong-helper.user.js` 或构建产物 `dist/Kasa-xuexitong-helper.user.js`。
2. **浏览器扩展方式**：在 Chrome / Edge 扩展管理页面开启开发者模式，加载仓库中的 `chrome-extension/` 目录。
3. 如需 AI 自动答题，在页面右上角脚本面板的「AI 设置」中填入接口地址与 API Key 并保存。

## 本地构建

```bash
npm install
npm run dev
npm run build
npm test
```

## License

[MIT](LICENSE)
