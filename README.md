# Kasa-xuexitong-helper

超星学习通辅助脚本，支持课程视频播放、文档浏览、章节自动切换及作业/测验自动作答。

## 功能说明

- **音视频播放**：原速静音播放，切屏或失焦暂停后自动恢复。
- **文档浏览**：自动完成课件与文档任务点阅读。
- **章节连播**：当前章节任务点完成后自动进入下一节。
- **作业与测验**：支持单选、多选、判断、填空与简答题解析（内置动态混淆字体还原），可对接 OpenAI 兼容接口（DeepSeek、SiliconFlow、OpenAI 等）。

## 安装使用

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 导入仓库中的 `Kasa-xuexitong-helper.user.js` 即可使用。
3. 如需自动答题，在页面右上角脚本面板的「AI 设置」中填入接口地址与 API Key 并保存。

## 本地构建

```bash
npm install
npm run dev
npm run build
```

## License

[MIT](LICENSE)

