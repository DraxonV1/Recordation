/**
 * Recordation - Mobile & Desktop Popup Controller
 * Manages recording lifecycle, steps view, import/export to .rec format.
 */

(function () {
  'use strict';

  // DOM Elements
  const statusChip = document.getElementById('status-chip');
  const statusDot = document.getElementById('status-dot');
  const statusLabel = document.getElementById('status-label');

  const idleControls = document.getElementById('idle-controls');
  const activeControls = document.getElementById('active-controls');
  const flowTitleInput = document.getElementById('flow-title');

  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const pauseText = document.getElementById('pause-text');
  const btnStop = document.getElementById('btn-stop');

  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const fileImport = document.getElementById('file-import');
  const btnExportRec = document.getElementById('btn-export-rec');
  const btnClear = document.getElementById('btn-clear');

  const stepsList = document.getElementById('steps-list');
  const emptyState = document.getElementById('empty-state');
  const stepsHeaderCount = document.getElementById('steps-header-count');
  const recordingStepsCount = document.getElementById('recording-steps-count');
  const recordingTimer = document.getElementById('recording-timer');
  const toast = document.getElementById('toast');

  // Local state
  let isRecording = false;
  let isPaused = false;
  let currentSession = null;
  let timerInterval = null;
  let recordingStartMs = 0;

  // Initialize
  document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await refreshState();
    
    // Auto-fill flow title from active tab if empty
    if (!flowTitleInput.value.trim() && !isRecording) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.title) {
          flowTitleInput.value = `Flow on ${tab.title.substring(0, 30)}`;
        }
      } catch (e) {}
    }
  });

  // Query background for current recording state
  async function refreshState() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (res && res.success && res.data) {
        isRecording = res.data.isRecording;
        isPaused = res.data.isPaused;
        currentSession = res.data.currentSession;
        updateUI();
      }
    } catch (e) {
      console.warn('Could not fetch state', e);
    }
  }

  function setupEventListeners() {
    btnStart.addEventListener('click', onStartRecording);
    btnPause.addEventListener('click', onTogglePause);
    btnStop.addEventListener('click', onStopRecording);
    btnExportRec.addEventListener('click', () => exportRecFile(currentSession));
    btnClear.addEventListener('click', onClearSession);

    btnImportTrigger.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', onImportFile);

    // Listen for background broadcasts
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'RECORDING_STATE_CHANGED') {
        isRecording = !!msg.isRecording;
        isPaused = !!msg.isPaused;
        if (msg.session) currentSession = msg.session;
        updateUI();
      } else if (msg.type === 'STEP_ADDED' || msg.type === 'STEP_UPDATED' || msg.type === 'SESSION_UPDATED') {
        refreshState();
      }
    });
  }

  // Update complete UI based on state
  function updateUI() {
    // 1. Status Chip
    if (!isRecording) {
      statusDot.className = 'status-dot';
      statusLabel.textContent = 'Idle';
      idleControls.style.display = 'block';
      activeControls.style.display = 'none';
      stopTimer();
    } else if (isPaused) {
      statusDot.className = 'status-dot paused';
      statusLabel.textContent = 'Paused';
      idleControls.style.display = 'none';
      activeControls.style.display = 'block';
      pauseText.textContent = 'Resume';
    } else {
      statusDot.className = 'status-dot recording';
      statusLabel.textContent = 'Recording';
      idleControls.style.display = 'none';
      activeControls.style.display = 'block';
      pauseText.textContent = 'Pause';
      startTimer();
    }

    // 2. Steps render
    const steps = currentSession?.steps || [];
    stepsHeaderCount.textContent = steps.length;
    recordingStepsCount.textContent = steps.length;

    btnExportRec.disabled = steps.length === 0;
    btnClear.disabled = steps.length === 0 && !isRecording;

    renderStepsList(steps);
  }

  // Render recorded steps
  function renderStepsList(steps) {
    if (!steps || steps.length === 0) {
      stepsList.innerHTML = '';
      stepsList.appendChild(emptyState);
      return;
    }

    stepsList.innerHTML = '';

    steps.forEach((step, idx) => {
      const card = document.createElement('div');
      card.className = 'step-card';

      const typeBadgeClass = `badge-${step.type}`;
      const desc = step.description || `${step.type.toUpperCase()}`;

      let detailsHtml = '';
      if (step.url) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">URL:</span><span>${escapeHtml(step.url)}</span></div>`;
      }
      if (step.target?.selectors?.css) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">CSS:</span><span>${escapeHtml(step.target.selectors.css)}</span></div>`;
      }
      if (step.target?.selectors?.xpath) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">XPath:</span><span>${escapeHtml(step.target.selectors.xpath)}</span></div>`;
      }
      if (step.value !== null && step.value !== undefined) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">Value:</span><span>"${escapeHtml(String(step.value))}"</span></div>`;
      }
      if (step.key) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">Key:</span><span>${escapeHtml(step.key)}</span></div>`;
      }
      if (step.scroll) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">Pos:</span><span>X:${step.scroll.x}, Y:${step.scroll.y}</span></div>`;
      }
      if (step.delayMs !== undefined) {
        detailsHtml += `<div class="detail-row"><span class="detail-label">Delay:</span><span>${step.delayMs} ms</span></div>`;
      }

      card.innerHTML = `
        <div class="step-header">
          <div class="step-left">
            <span class="step-idx">#${idx + 1}</span>
            <span class="badge ${typeBadgeClass}">${step.type}</span>
          </div>
          <div class="step-right">
            <button class="step-del-btn" data-index="${idx}" title="Delete step">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="step-desc">${escapeHtml(desc)}</div>
        <button class="toggle-details-btn" data-details-id="details-${idx}">View Selectors &#9662;</button>
        <div class="step-details" id="details-${idx}">
          ${detailsHtml}
        </div>
      `;

      // Details toggle listener
      const toggleBtn = card.querySelector('.toggle-details-btn');
      const detailsContainer = card.querySelector(`#details-${idx}`);
      toggleBtn.addEventListener('click', () => {
        const isOpen = detailsContainer.classList.toggle('open');
        toggleBtn.innerHTML = isOpen ? 'Hide Selectors &#9652;' : 'View Selectors &#9662;';
      });

      // Delete step listener
      const delBtn = card.querySelector('.step-del-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteStep(idx);
      });

      stepsList.appendChild(card);
    });

    // Auto scroll to latest step
    stepsList.scrollTop = stepsList.scrollHeight;
  }

  // Timer helpers
  function startTimer() {
    if (timerInterval) return;
    if (currentSession?.metadata?.createdAt) {
      recordingStartMs = new Date(currentSession.metadata.createdAt).getTime();
    } else {
      recordingStartMs = Date.now();
    }

    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay() {
    const elapsedSec = Math.floor(Math.max(0, Date.now() - recordingStartMs) / 1000);
    const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const secs = (elapsedSec % 60).toString().padStart(2, '0');
    recordingTimer.textContent = `${mins}:${secs}`;
  }

  // Handlers
  async function onStartRecording() {
    const title = flowTitleInput.value.trim() || 'Recorded Automation Flow';
    
    // Get active tab and viewport dimensions
    let activeTab = null;
    let viewport = { width: 412, height: 915 }; // Default mobile viewport

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      if (tab?.width && tab?.height) {
        viewport = { width: tab.width, height: tab.height };
      }
    } catch (e) {}

    const res = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      payload: {
        title: title,
        tabId: activeTab?.id,
        startUrl: activeTab?.url,
        viewport: viewport
      }
    });

    if (res && res.success) {
      showToast('Recording started! Interact on page.');
      await refreshState();
      // On mobile browsers, close popup to return user directly to active tab
      setTimeout(() => {
        window.close();
      }, 500);
    } else {
      showToast('Failed to start recording');
    }
  }

  async function onTogglePause() {
    const action = isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING';
    const res = await chrome.runtime.sendMessage({ type: action });
    if (res && res.success) {
      showToast(isPaused ? 'Recording resumed' : 'Recording paused');
      await refreshState();
    }
  }

  async function onStopRecording() {
    const res = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (res && res.success && res.session) {
      currentSession = res.session;
      exportRecFile(currentSession);
      showToast('Recording saved! .rec file downloaded.');
      await refreshState();
    } else {
      showToast('Recording stopped');
      await refreshState();
    }
  }

  async function deleteStep(index) {
    const res = await chrome.runtime.sendMessage({
      type: 'DELETE_STEP',
      payload: { index }
    });
    if (res && res.success) {
      showToast(`Deleted step #${index + 1}`);
      await refreshState();
    }
  }

  async function onClearSession() {
    if (!confirm('Are you sure you want to clear all recorded steps?')) return;
    const res = await chrome.runtime.sendMessage({ type: 'CLEAR_CURRENT_SESSION' });
    if (res && res.success) {
      currentSession = null;
      showToast('Session cleared');
      await refreshState();
    }
  }

  // Export current session to .rec format
  function exportRecFile(session) {
    if (!session || !session.steps || session.steps.length === 0) {
      showToast('No steps to export');
      return;
    }

    try {
      const dataStr = JSON.stringify(session, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = (session.metadata?.title || 'flow')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .substring(0, 32);
      
      a.href = url;
      a.download = `${safeTitle}.rec`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      showToast(`Exported ${safeTitle}.rec`);
    } catch (e) {
      showToast('Export failed: ' + e.message);
    }
  }

  // Import .rec file
  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (!parsed.steps || !Array.isArray(parsed.steps)) {
          throw new Error('Invalid format: missing steps array');
        }

        currentSession = {
          version: parsed.version || '1.0.0',
          format: 'recordation.rec',
          metadata: parsed.metadata || {
            title: file.name.replace(/\.(rec|json)$/i, ''),
            createdAt: new Date().toISOString(),
            startUrl: parsed.steps[0]?.url || 'about:blank',
            viewport: { width: 412, height: 915 }
          },
          steps: parsed.steps
        };

        // Save imported session as active in storage
        await chrome.storage.local.set({ currentSession: currentSession });
        showToast(`Imported ${parsed.steps.length} steps from ${file.name}`);
        updateUI();
      } catch (err) {
        showToast('Import error: ' + err.message);
      } finally {
        fileImport.value = '';
      }
    };
    reader.readAsText(file);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
