/**
 * Recordation - Mobile & Desktop Floating Recording HUD
 * Injected into the page during active recording.
 * Provides on-screen controls: Step count, Pause/Resume, Stop & Export.
 * Fully encapsulated in Shadow DOM to avoid CSS conflicts.
 */

window.RecordationHUD = (function () {
  'use strict';

  let hostElement = null;
  let shadowRoot = null;
  let isMinimized = false;
  let isPaused = false;
  let stepCount = 0;
  let lastActionText = 'Ready to record';

  // Drag state
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 20;
  let currentY = 20;

  function init() {
    if (document.getElementById('recordation-hud-host')) {
      return;
    }

    hostElement = document.createElement('div');
    hostElement.id = 'recordation-hud-host';
    hostElement.setAttribute('data-recordation-ignore', 'true');
    hostElement.style.position = 'fixed';
    hostElement.style.top = '20px';
    hostElement.style.right = '20px';
    hostElement.style.zIndex = '2147483647'; // Max z-index
    hostElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    hostElement.style.userSelect = 'none';
    hostElement.style.webkitUserSelect = 'none';

    shadowRoot = hostElement.attachShadow({ mode: 'open' });
    render();
    setupEvents();

    if (document.body) {
      document.body.appendChild(hostElement);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(hostElement);
      });
    }
  }

  function render() {
    if (!shadowRoot) return;

    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        .hud-container {
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
          border-radius: 16px;
          color: #f8fafc;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 260px;
          transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.1s ease;
          touch-action: none;
        }
        .hud-container.minimized {
          width: auto;
          padding: 8px 12px;
          border-radius: 9999px;
        }
        .hud-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: grab;
        }
        .hud-header:active {
          cursor: grabbing;
        }
        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 10px #ef4444;
          animation: pulse 1.5s infinite;
        }
        .dot.paused {
          background: #f59e0b;
          box-shadow: 0 0 8px #f59e0b;
          animation: none;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.15); }
        }
        .counter {
          background: rgba(255, 255, 255, 0.12);
          padding: 2px 7px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          color: #e2e8f0;
        }
        .header-tools {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .icon-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .icon-btn:hover, .icon-btn:active {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }
        .hud-body {
          display: ${isMinimized ? 'none' : 'flex'};
          flex-direction: column;
          gap: 8px;
        }
        .last-action {
          font-size: 11px;
          color: #cbd5e1;
          background: rgba(0, 0, 0, 0.3);
          padding: 6px 8px;
          border-radius: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-left: 2px solid #6366f1;
        }
        .action-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border: none;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.05s;
        }
        .btn:active {
          transform: scale(0.97);
        }
        .btn-pause {
          background: rgba(245, 158, 11, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.4);
        }
        .btn-pause:active {
          background: rgba(245, 158, 11, 0.35);
        }
        .btn-stop {
          background: #ef4444;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4);
        }
        .btn-stop:active {
          background: #dc2626;
        }
      </style>

      <div class="hud-container ${isMinimized ? 'minimized' : ''}" id="hud-root">
        <div class="hud-header" id="drag-handle">
          <div class="status-badge">
            <span class="dot ${isPaused ? 'paused' : ''}"></span>
            <span>${isPaused ? 'PAUSED' : 'REC'}</span>
            <span class="counter" id="step-counter">${stepCount}</span>
          </div>
          <div class="header-tools">
            <button class="icon-btn" id="toggle-min-btn" title="${isMinimized ? 'Expand' : 'Minimize'}">
              ${isMinimized ? '&#9660;' : '&#9650;'}
            </button>
          </div>
        </div>

        <div class="hud-body">
          <div class="last-action" id="last-action-label" title="${escapeHtml(lastActionText)}">
            ${escapeHtml(lastActionText)}
          </div>
          <div class="action-row">
            <button class="btn btn-pause" id="hud-pause-btn">
              ${isPaused ? '&#9658; Resume' : '&#10074;&#10074; Pause'}
            </button>
            <button class="btn btn-stop" id="hud-stop-btn">
              &#9632; Save .rec
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setupEvents() {
    if (!shadowRoot) return;

    const dragHandle = shadowRoot.getElementById('drag-handle');
    const toggleMinBtn = shadowRoot.getElementById('toggle-min-btn');
    const pauseBtn = shadowRoot.getElementById('hud-pause-btn');
    const stopBtn = shadowRoot.getElementById('hud-stop-btn');

    if (toggleMinBtn) {
      toggleMinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isMinimized = !isMinimized;
        render();
        setupEvents();
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING';
        chrome.runtime.sendMessage({ type: action });
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        if (res && res.session) {
          downloadRecFile(res.session);
        }
      });
    }

    // Touch & Mouse Dragging handlers
    function onPointerDown(e) {
      // Don't drag if clicking buttons
      if (e.target.closest('button')) return;

      isDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const rect = hostElement.getBoundingClientRect();
      startX = clientX - rect.left;
      startY = clientY - rect.top;

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      let newX = clientX - startX;
      let newY = clientY - startY;

      // Bound to screen edges
      const maxX = window.innerWidth - hostElement.offsetWidth - 5;
      const maxY = window.innerHeight - hostElement.offsetHeight - 5;
      newX = Math.max(5, Math.min(newX, maxX));
      newY = Math.max(5, Math.min(newY, maxY));

      hostElement.style.left = `${newX}px`;
      hostElement.style.top = `${newY}px`;
      hostElement.style.right = 'auto';
    }

    function onPointerUp() {
      isDragging = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    }

    if (dragHandle) {
      dragHandle.addEventListener('pointerdown', onPointerDown);
      dragHandle.addEventListener('touchstart', onPointerDown, { passive: true });
    }
  }

  // Trigger browser download of .rec file
  function downloadRecFile(session) {
    try {
      const jsonStr = JSON.stringify(session, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = (session.metadata?.title || 'recording')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .substring(0, 30);
      a.href = url;
      a.download = `${safeTitle}.rec`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
    } catch (e) {
      console.error('Failed to trigger .rec download', e);
    }
  }

  function updateState({ recording, paused, count, lastAction }) {
    if (recording) {
      if (!hostElement || !document.getElementById('recordation-hud-host')) {
        init();
      }
      isPaused = !!paused;
      if (typeof count === 'number') stepCount = count;
      if (lastAction) lastActionText = lastAction;

      render();
      setupEvents();
    } else {
      destroy();
    }
  }

  function setStepCount(count, lastAction) {
    stepCount = count;
    if (lastAction) lastActionText = lastAction;
    render();
    setupEvents();
  }

  function destroy() {
    if (hostElement) {
      hostElement.remove();
      hostElement = null;
      shadowRoot = null;
    }
  }

  return {
    init,
    updateState,
    setStepCount,
    destroy,
    downloadRecFile
  };
})();
