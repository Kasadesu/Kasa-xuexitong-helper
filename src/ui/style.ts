export const PANEL_STYLES = `
:host {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #1f2937;
  user-select: none;
  z-index: 2147483647 !important;
  position: fixed !important;
  display: block !important;
  pointer-events: auto !important;
}

* {
  box-sizing: border-box;
}

.kasa-card {
  width: 330px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(229, 231, 235, 0.9);
  border-radius: 12px;
  box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}

.kasa-card:hover {
  box-shadow: 0 20px 30px -5px rgba(0, 0, 0, 0.18), 0 8px 12px -6px rgba(0, 0, 0, 0.08);
}

.kasa-header {
  padding: 10px 14px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: grab;
  touch-action: none;
}

.kasa-header:active {
  cursor: grabbing;
}

/* Progress Section */
.kasa-progress-box {
  padding: 10px 14px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
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
  color: #334155;
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
  color: #2563eb;
}

.kasa-progress-status.playing::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 6px #16a34a;
  animation: kasa-pulse 1.5s infinite;
}

.kasa-progress-status.paused::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d97706;
}

.kasa-progress-status.finished::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2563eb;
}

.kasa-progress-status.idle::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
}

@keyframes kasa-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

.kasa-progress-track {
  width: 100%;
  height: 6px;
  background: #e2e8f0;
  border-radius: 9999px;
  overflow: hidden;
  margin-bottom: 4px;
}

.kasa-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  border-radius: 9999px;
  width: 0%;
  transition: width 0.25s ease;
}

.kasa-progress-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.kasa-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kasa-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 9999px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.kasa-title {
  font-size: 13px;
  font-weight: 600;
}

.kasa-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kasa-btn-icon {
  background: none;
  border: none;
  color: #ffffff;
  opacity: 0.8;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1;
}

.kasa-btn-icon:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.2);
}

.kasa-tabs {
  display: flex;
  border-bottom: 1px solid #f3f4f6;
  background: #f9fafb;
}

.kasa-tab {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.kasa-tab.active {
  color: #2563eb;
  font-weight: 600;
  border-bottom-color: #2563eb;
  background: #ffffff;
}

.kasa-body {
  padding: 12px 14px;
  max-height: 380px;
  overflow-y: auto;
}

/* Scrollbar */
.kasa-body::-webkit-scrollbar {
  width: 5px;
}
.kasa-body::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
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
}

.log-time {
  color: #9ca3af;
  flex-shrink: 0;
}

.log-msg.info { color: #374151; }
.log-msg.success { color: #16a34a; font-weight: 500; }
.log-msg.warning { color: #d97706; }
.log-msg.error { color: #dc2626; font-weight: 500; }

/* Settings View */
.setting-item {
  margin-bottom: 12px;
}

.setting-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #4b5563;
  margin-bottom: 4px;
}

.setting-input, .setting-select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 12px;
  color: #1f2937;
  outline: none;
  background: #ffffff;
}

.setting-input:focus, .setting-select:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
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
  background-color: #cbd5e1;
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
  background-color: #2563eb;
}

input:checked + .toggle-slider:before {
  transform: translateX(16px);
}

.minimized-ball {
  width: 44px;
  height: 44px;
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  color: #ffffff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: bold;
  cursor: grab;
  box-shadow: 0 8px 16px rgba(37, 99, 235, 0.35);
  transition: transform 0.15s ease;
}

.minimized-ball:hover {
  transform: scale(1.08);
}

/* Action & Setting Buttons */
.kasa-btn-fetch {
  margin-top: 6px;
  width: 100%;
  padding: 6px 10px;
  background: #f1f5f9;
  color: #2563eb;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.kasa-btn-fetch:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.kasa-btn-fetch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.kasa-btn-save {
  width: 100%;
  padding: 8px 12px;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
  transition: all 0.2s ease;
}

.kasa-btn-save:hover {
  background: #1d4ed8;
  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.3);
}

.kasa-btn-save.saved {
  background: #16a34a !important;
  box-shadow: 0 2px 4px rgba(22, 163, 74, 0.3) !important;
}

.kasa-link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: #2563eb;
  cursor: pointer;
  text-decoration: underline;
  font-weight: normal;
}

.kasa-link-btn:hover {
  color: #1d4ed8;
}

.kasa-input-btn-group {
  display: flex;
  gap: 6px;
  align-items: center;
}
`;
