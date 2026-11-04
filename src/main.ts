import './ui/floating-card';
import { ChapterScheduler } from './core/scheduler';
import { store } from './store';

const init = () => {
  // Only mount UI and start top-level scheduler in top window to prevent duplicate iframe execution
  if (window.top !== window.self) {
    return;
  }

  const mountPanel = () => {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', mountPanel, { once: true });
      return;
    }
    if (!document.querySelector('kasa-helper-panel')) {
      const panel = document.createElement('kasa-helper-panel');
      document.body.appendChild(panel);
      store.addLog('面板已就绪', 'info');
    }
  };

  mountPanel();

  // Start automation scheduler
  const scheduler = new ChapterScheduler();
  scheduler.start();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
