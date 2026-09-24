/**
 * Recordation - Background Service Worker
 * Manages recording state, listens for navigations across tabs, and coordinates events.
 */

const BADGE_COLORS = {
  RECORDING: '#EF4444',
  PAUSED: '#F59E0B',
  IDLE: '#64748B'
};

// Initialize default storage state
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['isRecording', 'isPaused', 'currentSession', 'savedSessions']);
  if (existing.isRecording === undefined) {
    await chrome.storage.local.set({
      isRecording: false,
      isPaused: false,
      recordingTabId: null,
      currentSession: null,
      savedSessions: []
    });
  }
  updateBadge(false, false, 0);
});

function updateBadge(isRecording, isPaused, stepCount = 0) {
  if (!isRecording) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Recordation - Idle' });
    return;
  }

  if (isPaused) {
    chrome.action.setBadgeText({ text: 'PAUSE' });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.PAUSED });
    chrome.action.setTitle({ title: 'Recordation - Recording Paused' });
  } else {
    const text = stepCount > 0 ? (stepCount > 99 ? '99+' : `${stepCount}`) : 'REC';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.RECORDING });
    chrome.action.setTitle({ title: `Recordation - Recording Active (${stepCount} steps)` });
  }
}

// Track full page navigations on the recorded tab
chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only track top-level frame navigations
  if (details.frameId !== 0) return;

  const state = await chrome.storage.local.get(['isRecording', 'isPaused', 'recordingTabId', 'currentSession']);
  if (!state.isRecording || state.isPaused) return;
  if (state.recordingTabId !== null && state.recordingTabId !== details.tabId) return;

  const url = details.url;
  // Ignore internal/extension URLs
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
    return;
  }

  const session = state.currentSession;
  if (!session) return;

  const lastStep = session.steps[session.steps.length - 1];
  // Deduplicate identical navigation if already logged very recently
  if (lastStep && lastStep.type === 'navigate' && lastStep.url === url) {
    const timeDiff = Date.now() - (lastStep.timestamp || 0);
    if (timeDiff < 1000) return;
  }

  const now = Date.now();
  const prevTime = lastStep ? (lastStep.timestamp || now) : (new Date(session.metadata.createdAt).getTime() || now);
  const delayMs = Math.max(0, now - prevTime);

  const navStep = {
    id: `step_${session.steps.length + 1}`,
    type: 'navigate',
    url: url,
    timestamp: now,
    delayMs: delayMs,
    transitionType: details.transitionType,
    description: `Navigate to ${url}`
  };

  session.steps.push(navStep);
  await chrome.storage.local.set({ currentSession: session });
  updateBadge(true, false, session.steps.length);

  // Broadcast step to popup and content script
  broadcastMessage({
    type: 'STEP_ADDED',
    step: navStep,
    totalSteps: session.steps.length
  });
});

// Broadcast message to all views and tabs
async function broadcastMessage(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch (e) {}

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  } catch (e) {}
}

// Ensure content script is running on the active tab
async function ensureContentScriptInjected(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.pong) return true;
  } catch (e) {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'content/selector-generator.js',
        'content/floating-hud.js',
        'content/recorder.js'
      ]
    });
    return true;
  } catch (e) {
    console.warn('Could not inject content script into tab', tabId, e);
    return false;
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(request, sender) {
  const { type, payload } = request;

  switch (type) {
    case 'GET_STATE': {
      const data = await chrome.storage.local.get([
        'isRecording',
        'isPaused',
        'recordingTabId',
        'currentSession',
        'savedSessions'
      ]);
      return {
        success: true,
        data: {
          isRecording: !!data.isRecording,
          isPaused: !!data.isPaused,
          recordingTabId: data.recordingTabId,
          currentSession: data.currentSession,
          savedCount: (data.savedSessions || []).length
        }
      };
    }

    case 'START_RECORDING': {
      let targetTabId = payload?.tabId;
      if (!targetTabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetTabId = activeTab?.id;
      }

      let startUrl = payload?.startUrl;
      let title = payload?.title || 'Automated Flow';
      let viewport = payload?.viewport || { width: 412, height: 915 }; // Default mobile viewport

      if (targetTabId) {
        try {
          const tab = await chrome.tabs.get(targetTabId);
          startUrl = startUrl || tab.url || 'about:blank';
          title = title === 'Automated Flow' && tab.title ? `Flow on ${tab.title}` : title;
          await ensureContentScriptInjected(targetTabId);
        } catch (e) {}
      }

      const now = Date.now();
      const newSession = {
        version: '1.0.0',
        format: 'recordation.rec',
        metadata: {
          title: title,
          description: payload?.description || '',
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          userAgent: payload?.userAgent || navigator.userAgent,
          viewport: viewport,
          device: payload?.device || (/Android/i.test(navigator.userAgent) ? 'Android Mobile' : 'Desktop'),
          startUrl: startUrl || 'about:blank',
          durationMs: 0
        },
        steps: []
      };

      // Add initial navigation step if URL is web-valid
      if (startUrl && !startUrl.startsWith('chrome') && !startUrl.startsWith('about:')) {
        newSession.steps.push({
          id: 'step_1',
          type: 'navigate',
          url: startUrl,
          timestamp: now,
          delayMs: 0,
          description: `Initial navigation to ${startUrl}`
        });
      }

      await chrome.storage.local.set({
        isRecording: true,
        isPaused: false,
        recordingTabId: targetTabId || null,
        currentSession: newSession
      });

      updateBadge(true, false, newSession.steps.length);

      broadcastMessage({
        type: 'RECORDING_STATE_CHANGED',
        isRecording: true,
        isPaused: false,
        session: newSession
      });

      return { success: true, session: newSession };
    }

    case 'STOP_RECORDING': {
      const state = await chrome.storage.local.get(['isRecording', 'currentSession', 'savedSessions']);
      const session = state.currentSession;

      if (session) {
        const startMs = new Date(session.metadata.createdAt).getTime();
        session.metadata.durationMs = Math.max(0, Date.now() - startMs);
        session.metadata.updatedAt = new Date().toISOString();

        const savedSessions = state.savedSessions || [];
        savedSessions.unshift(session);
        // Retain maximum 20 latest sessions in storage
        if (savedSessions.length > 20) {
          savedSessions.length = 20;
        }

        await chrome.storage.local.set({
          isRecording: false,
          isPaused: false,
          recordingTabId: null,
          currentSession: session,
          savedSessions: savedSessions
        });
      } else {
        await chrome.storage.local.set({
          isRecording: false,
          isPaused: false,
          recordingTabId: null
        });
      }

      updateBadge(false, false, 0);

      broadcastMessage({
        type: 'RECORDING_STATE_CHANGED',
        isRecording: false,
        isPaused: false,
        session: session
      });

      return { success: true, session: session };
    }

    case 'PAUSE_RECORDING': {
      await chrome.storage.local.set({ isPaused: true });
      const state = await chrome.storage.local.get(['currentSession']);
      const count = state.currentSession?.steps?.length || 0;
      updateBadge(true, true, count);

      broadcastMessage({
        type: 'RECORDING_STATE_CHANGED',
        isRecording: true,
        isPaused: true
      });
      return { success: true };
    }

    case 'RESUME_RECORDING': {
      await chrome.storage.local.set({ isPaused: false });
      const state = await chrome.storage.local.get(['currentSession']);
      const count = state.currentSession?.steps?.length || 0;
      updateBadge(true, false, count);

      broadcastMessage({
        type: 'RECORDING_STATE_CHANGED',
        isRecording: true,
        isPaused: false
      });
      return { success: true };
    }

    case 'RECORD_EVENT': {
      const state = await chrome.storage.local.get(['isRecording', 'isPaused', 'recordingTabId', 'currentSession']);
      if (!state.isRecording || state.isPaused) {
        return { success: false, reason: 'not_recording_or_paused' };
      }

      // Check tab ID match if sender is a tab
      if (sender.tab && state.recordingTabId !== null && state.recordingTabId !== sender.tab.id) {
        return { success: false, reason: 'different_tab' };
      }

      const session = state.currentSession;
      if (!session) return { success: false, reason: 'no_active_session' };

      const eventData = payload;
      const now = Date.now();
      const lastStep = session.steps[session.steps.length - 1];
      const prevTime = lastStep ? (lastStep.timestamp || now) : (new Date(session.metadata.createdAt).getTime() || now);
      const delayMs = Math.max(0, now - prevTime);

      const stepId = `step_${session.steps.length + 1}`;
      const step = {
        id: stepId,
        type: eventData.type,
        timestamp: now,
        delayMs: delayMs,
        url: eventData.url || (sender.tab ? sender.tab.url : session.metadata.startUrl),
        target: eventData.target || null,
        value: eventData.value !== undefined ? eventData.value : null,
        key: eventData.key !== undefined ? eventData.key : null,
        scroll: eventData.scroll || null,
        description: eventData.description || `${eventData.type.toUpperCase()} on ${eventData.target?.tag || 'element'}`
      };

      // Optimize consecutive input steps on the exact same element:
      // If user is typing into same target input, update the value of the last step instead of creating 50 keystroke steps
      if (step.type === 'input' && lastStep && lastStep.type === 'input' &&
          lastStep.target?.selectors?.css === step.target?.selectors?.css &&
          (now - lastStep.timestamp) < 3000) {
        lastStep.value = step.value;
        lastStep.timestamp = now;
        lastStep.description = `Type "${step.value}" into ${step.target?.tag || 'input'}`;
        await chrome.storage.local.set({ currentSession: session });
        broadcastMessage({
          type: 'STEP_UPDATED',
          step: lastStep,
          totalSteps: session.steps.length
        });
        return { success: true, step: lastStep };
      }

      session.steps.push(step);
      await chrome.storage.local.set({ currentSession: session });
      updateBadge(true, false, session.steps.length);

      broadcastMessage({
        type: 'STEP_ADDED',
        step: step,
        totalSteps: session.steps.length
      });

      return { success: true, step };
    }

    case 'DELETE_STEP': {
      const state = await chrome.storage.local.get(['currentSession']);
      const session = state.currentSession;
      if (!session) return { success: false };

      const stepIndex = payload?.index;
      if (typeof stepIndex === 'number' && stepIndex >= 0 && stepIndex < session.steps.length) {
        session.steps.splice(stepIndex, 1);
        // Re-index steps
        session.steps.forEach((s, idx) => {
          s.id = `step_${idx + 1}`;
        });
        await chrome.storage.local.set({ currentSession: session });
        broadcastMessage({
          type: 'SESSION_UPDATED',
          session: session
        });
        return { success: true, session };
      }
      return { success: false, error: 'invalid_index' };
    }

    case 'CLEAR_CURRENT_SESSION': {
      await chrome.storage.local.set({
        currentSession: null,
        isRecording: false,
        isPaused: false,
        recordingTabId: null
      });
      updateBadge(false, false, 0);
      broadcastMessage({
        type: 'RECORDING_STATE_CHANGED',
        isRecording: false,
        isPaused: false,
        session: null
      });
      return { success: true };
    }

    case 'UPDATE_SESSION_METADATA': {
      const state = await chrome.storage.local.get(['currentSession']);
      if (state.currentSession && payload) {
        Object.assign(state.currentSession.metadata, payload);
        await chrome.storage.local.set({ currentSession: state.currentSession });
        return { success: true, session: state.currentSession };
      }
      return { success: false };
    }

    default:
      return { success: false, error: `unknown_message_type: ${type}` };
  }
}
