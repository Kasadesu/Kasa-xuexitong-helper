import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Kasa-xuexitong-helper',
        namespace: 'kasa.ai',
        version: '1.0.0',
        description: '超星学习通辅助脚本：支持视频自动播放、章节连播与作业测验作答。',
        author: 'Kasa',
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='54' text-anchor='middle' dominant-baseline='central' font-size='82' font-family='Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif'%3E%F0%9F%92%AF%3C/text%3E%3C/svg%3E",
        match: [
          '*://*.chaoxing.com/*',
          '*://*.edu.cn/*',
          '*://*.nbdlib.cn/*',
          '*://*.hnsyu.net/*',
          '*://*.gdhkmooc.com/*'
        ],
        connect: ['*'],
        grant: [
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'unsafeWindow'
        ],
        'run-at': 'document-start'
      },
      build: {
        fileName: 'Kasa-xuexitong-helper.user.js'
      }
    })
  ]
});
