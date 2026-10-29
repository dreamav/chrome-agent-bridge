/**
 * Chrome Agent Bridge - Popup UI Helpers & Utilities
 */

// Native Chrome Tab Groups color palette
const CHROME_GROUP_COLORS = {
  grey: '#9aa0a6',
  blue: '#8ab4f8',
  red: '#f28b82',
  yellow: '#fdd663',
  green: '#81c995',
  pink: '#ff8bcb',
  purple: '#c58af9',
  cyan: '#78d9ec',
  orange: '#fcad70'
};

/**
 * Format current timestamp as a readable default session name
 */
function getFormattedNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `Сессия ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Display toast notification inside popup
 */
function createToastNotifier(toastElement) {
  let toastTimer = null;
  return function showToast(message, duration = 3000) {
    if (!toastElement) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastElement.textContent = message;
    toastElement.style.display = 'block';
    toastTimer = setTimeout(() => {
      toastElement.style.display = 'none';
      toastTimer = null;
    }, duration);
  };
}

/**
 * Download a string payload as a JSON file
 */
function downloadJsonFile(filename, jsonText) {
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
