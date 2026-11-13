export const PANEL_STYLES = `
:host {
  --kasa-bg: #FFFFFF;
  --kasa-surface: #FFFFFF;
  --kasa-surface-muted: #F1F5F9;
  --kasa-surface-subtle: #F8FAFC;
  --kasa-border: #E2E8F0;
  --kasa-border-strong: #CBD5E1;
  --kasa-text: #0F172A;
  --kasa-text-secondary: #475569;
  --kasa-text-muted: #64748B;
  --kasa-primary: #2563EB;
  --kasa-primary-hover: #1D4ED8;
  --kasa-primary-subtle: #EFF6FF;
  --kasa-success: #059669;
  --kasa-warning: #D97706;
  --kasa-danger: #DC2626;
  --kasa-danger-hover: #B91C1C;
  --kasa-danger-text: #991B1B;
  --kasa-danger-bg: #FFF1F2;
  --kasa-danger-border: #FECACA;
  --kasa-radius-sm: 4px;
  --kasa-radius-md: 8px;
  --kasa-radius-lg: 12px;
  --kasa-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --kasa-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
  --kasa-shadow-lg: 0 10px 25px -3px rgba(15, 23, 42, 0.1), 0 4px 10px -4px rgba(15, 23, 42, 0.05);

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kasa-text);
  user-select: none;
  z-index: 2147483647 !important;
  position: fixed !important;
  display: block !important;
  pointer-events: auto !important;
}

* {
  box-sizing: border-box;
}

button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--kasa-primary);
  outline-offset: 1px;
}

.kasa-card {
  width: 340px;
  background: var(--kasa-bg);
  border: 1px solid var(--kasa-border);
  border-radius: var(--kasa-radius-lg);
  box-shadow: var(--kasa-shadow-lg);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.kasa-card:hover {
  box-shadow: 0 16px 30px -5px rgba(15, 23, 42, 0.14), 0 6px 12px -4px rgba(15, 23, 42, 0.06);
}

/* Header */
.kasa-header {
  padding: 10px 14px;
  background: #FFFFFF;
  border-bottom: 1px solid var(--kasa-border);
  color: var(--kasa-text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  touch-action: none;
}

.kasa-header:active {
  cursor: grabbing;
}

.kasa-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kasa-badge {
  font-size: 11px;
  padding: 1px 6px;
  background: var(--kasa-surface-muted);
  color: var(--kasa-text-secondary);
  border: 1px solid var(--kasa-border);
  border-radius: var(--kasa-radius-sm);
  font-weight: 600;
  letter-spacing: 0.3px;
}

.kasa-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--kasa-text);
}

.kasa-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Start/Pause Quiz Action Button */
.kasa-btn-quiz {
  font-size: 12px;
  padding: 4px 10px;
  color: #FFFFFF;
  border: 1px solid transparent;
  border-radius: var(--kasa-radius-sm);
  cursor: pointer;
  font-weight: 600;
  margin-right: 2px;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.kasa-btn-quiz.start {
  background: var(--kasa-primary);
}

.kasa-btn-quiz.start:hover {
  background: var(--kasa-primary-hover);
}

.kasa-btn-quiz.pause {
  background: var(--kasa-warning);
}

.kasa-btn-quiz.pause:hover {
  background: #B45309;
}

.kasa-btn-quiz.resume {
  background: #0284C7;
}

.kasa-btn-quiz.resume:hover {
  background: #0369A1;
}

.kasa-btn-icon {
  background: transparent;
  border: none;
  color: var(--kasa-text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--kasa-radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  transition: all 0.15s ease;
}

.kasa-btn-icon:hover {
  background: var(--kasa-surface-muted);
  color: var(--kasa-text);
}

/* Progress Section */
.kasa-progress-box {
  padding: 10px 14px 8px;
  background: var(--kasa-surface-subtle);
  border-bottom: 1px solid var(--kasa-border);
}

.kasa-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 11px;
}

.kasa-progress-title {
  font-weight: 500;
  color: var(--kasa-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 210px;
}

.kasa-progress-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--kasa-primary);
}

.kasa-progress-status.playing::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kasa-success);
  box-shadow: 0 0 6px var(--kasa-success);
  animation: kasa-pulse 1.5s infinite;
}

.kasa-progress-status.paused::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kasa-warning);
}

.kasa-progress-status.finished::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kasa-primary);
}

.kasa-progress-status.idle::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--kasa-border-strong);
}

@keyframes kasa-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.kasa-progress-track {
  width: 100%;
  height: 5px;
  background: var(--kasa-border);
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 4px;
}

.kasa-progress-bar {
  height: 100%;
  background: var(--kasa-primary);
  border-radius: 9999px;
  width: 0%;
  transition: width 0.25s ease;
}

.kasa-progress-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--kasa-text-muted);
  font-family: ui-monospace, monospace;
}

/* Tabs: Segmented Capsule Track */
.kasa-tabs {
  display: flex;
  background: var(--kasa-surface-muted);
  padding: 3px;
  border-radius: var(--kasa-radius-md);
  margin: 8px 12px 0;
  gap: 4px;
}

.kasa-tab {
  flex: 1;
  text-align: center;
  padding: 6px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--kasa-text-secondary);
  cursor: pointer;
  border-radius: var(--kasa-radius-sm);
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  position: relative;
}

.kasa-tab:hover {
  color: var(--kasa-text);
}

.kasa-tab.active {
  color: var(--kasa-primary);
  font-weight: 600;
  background: #FFFFFF;
  box-shadow: var(--kasa-shadow-sm);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: var(--kasa-danger);
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 700;
  border-radius: 9999px;
  line-height: 1;
}

/* Body */
.kasa-body {
  padding: 10px 12px;
  max-height: 380px;
  overflow-y: auto;
}

.kasa-body::-webkit-scrollbar {
  width: 4px;
}
.kasa-body::-webkit-scrollbar-thumb {
  background: var(--kasa-border-strong);
  border-radius: 4px;
}

/* Pinned Error Alerts */
.kasa-pinned-alerts {
  background: var(--kasa-danger-bg);
  border: 1px solid var(--kasa-danger-border);
  border-left: 3px solid var(--kasa-danger);
  border-radius: var(--kasa-radius-md);
  padding: 8px 10px;
  margin-bottom: 8px;
}

.pinned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.pinned-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--kasa-danger-text);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pinned-btn-ack-all {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  background: #FFFFFF;
  border: 1px solid var(--kasa-danger-border);
  color: var(--kasa-danger-text);
  border-radius: var(--kasa-radius-sm);
  cursor: pointer;
  min-height: 22px;
  transition: all 0.15s ease;
}

.pinned-btn-ack-all:hover {
  background: #FEE2E2;
  border-color: var(--kasa-danger);
}

.pinned-list {
  max-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pinned-list::-webkit-scrollbar {
  width: 4px;
}
.pinned-list::-webkit-scrollbar-thumb {
  background: #FCA5A5;
  border-radius: 4px;
}

.pinned-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  background: #FFFFFF;
  border-radius: var(--kasa-radius-sm);
  border: 1px solid #FEE2E2;
}

.pinned-item-content {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  color: var(--kasa-text);
  font-size: 11px;
  line-height: 1.4;
}

.pinned-item-time {
  color: var(--kasa-danger-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  margin-right: 4px;
}

.pinned-item-badge {
  display: inline-block;
  background: var(--kasa-danger);
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 9999px;
  margin-left: 4px;
  line-height: 1.3;
}

.kasa-ack-btn {
  flex-shrink: 0;
  min-height: 24px;
  padding: 1px 7px;
  background: #FFFFFF;
  border: 1px solid var(--kasa-danger-border);
  color: var(--kasa-danger-text);
  border-radius: var(--kasa-radius-sm);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.kasa-ack-btn:hover {
  background: #FEE2E2;
  border-color: var(--kasa-danger);
}

.kasa-ack-btn:focus-visible {
  outline: 2px solid var(--kasa-danger);
  outline-offset: 1px;
}

/* Log View */
.log-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.log-item {
  display: flex;
  gap: 6px;
  line-height: 1.4;
  word-break: break-all;
  align-items: baseline;
}

.log-time {
  color: var(--kasa-text-muted);
  flex-shrink: 0;
  font-size: 10px;
}

.log-msg.info { color: var(--kasa-text-secondary); }
.log-msg.success { color: var(--kasa-success); font-weight: 500; }
.log-msg.warning { color: var(--kasa-warning); }
.log-msg.error { color: var(--kasa-danger); font-weight: 600; }

/* Settings View */
.setting-item {
  margin-bottom: 12px;
}

.setting-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--kasa-text-secondary);
  margin-bottom: 4px;
}

.setting-input, .setting-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--kasa-border-strong);
  border-radius: var(--kasa-radius-sm);
  font-size: 12px;
  color: var(--kasa-text);
  outline: none;
  background: #FFFFFF;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.setting-input:focus, .setting-select:focus {
  border-color: var(--kasa-primary);
  box-shadow: 0 0 0 2px var(--kasa-primary-subtle);
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--kasa-border-strong);
  transition: .2s;
  border-radius: 18px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: .2s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: var(--kasa-primary);
}

input:checked + .toggle-slider:before {
  transform: translateX(16px);
}

/* Minimized Floating Ball */
.minimized-ball {
  width: 44px;
  height: 44px;
  background: var(--kasa-primary);
  color: #FFFFFF;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: var(--kasa-shadow-md);
  position: relative;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.minimized-ball:hover {
  transform: scale(1.06);
  background: var(--kasa-primary-hover);
}

.minimized-alert-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: var(--kasa-danger);
  color: #FFFFFF;
  font-size: 10px;
  font-weight: 700;
  border-radius: 9999px;
  border: 2px solid #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  pointer-events: none;
  line-height: 1;
}

/* Action & Setting Buttons */
.kasa-btn-fetch {
  margin-top: 6px;
  width: 100%;
  padding: 6px 10px;
  background: var(--kasa-surface-muted);
  color: var(--kasa-primary);
  border: 1px solid var(--kasa-border-strong);
  border-radius: var(--kasa-radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.kasa-btn-fetch:hover:not(:disabled) {
  background: #E2E8F0;
  border-color: #94A3B8;
}

.kasa-btn-fetch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.kasa-btn-save {
  width: 100%;
  padding: 8px 12px;
  background: var(--kasa-primary);
  color: #FFFFFF;
  border: none;
  border-radius: var(--kasa-radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(37, 99, 235, 0.2);
  transition: all 0.15s ease;
}

.kasa-btn-save:hover {
  background: var(--kasa-primary-hover);
}

.kasa-btn-save.saved {
  background: var(--kasa-success) !important;
}

.kasa-link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: var(--kasa-primary);
  cursor: pointer;
  text-decoration: underline;
  font-weight: normal;
}

.kasa-link-btn:hover {
  color: var(--kasa-primary-hover);
}

.kasa-input-btn-group {
  display: flex;
  gap: 6px;
  align-items: center;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
