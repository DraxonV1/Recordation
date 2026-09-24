/**
 * Recordation - Content Script Recorder
 * Captures user actions (click, input, change, keydown, scroll, submit, SPA navigate)
 * and relays them to the background service worker.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__RECORDATION_INJECTED__) {
    return;
  }
  window.__RECORDATION_INJECTED__ = true;

  let isRecording = false;
  let isPaused = false;
  let listenersAttached = false;
  let scrollTimeout = null;
  let lastScrollPos = { x: 0, y: 0 };

  // Check if target element should be ignored (e.g. HUD elements)
  function isIgnored(element) {
    if (!element) return true;
    if (element.nodeType === Node.DOCUMENT_NODE) return false;
    if (element.nodeType !== Node.ELEMENT_NODE) {
      element = element.parentElement;
    }
    if (!element) return true;
    return !!element.closest('[data-recordation-ignore="true"]') || element.id === 'recordation-hud-host';
  }

  // Visual tap indicator for mobile feedback
  function showTapIndicator(x, y) {
    try {
      const ring = document.createElement('div');
      ring.setAttribute('data-recordation-ignore', 'true');
      ring.style.position = 'fixed';
      ring.style.left = `${x - 15}px`;
      ring.style.top = `${y - 15}px`;
      ring.style.width = '30px';
      ring.style.height = '30px';
      ring.style.borderRadius = '50%';
      ring.style.border = '2px solid #ef4444';
      ring.style.background = 'rgba(239, 68, 68, 0.25)';
      ring.style.pointerEvents = 'none';
      ring.style.zIndex = '2147483646';
      ring.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
      ring.style.transform = 'scale(0.5)';
      ring.style.opacity = '1';

      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = 'scale(1.8)';
        ring.style.opacity = '0';
      });
      setTimeout(() => {
        if (ring.parentElement) ring.parentElement.removeChild(ring);
      }, 450);
    } catch (e) {}
  }

  // Relay recorded event to background worker
  function recordEvent(eventData) {
    if (!isRecording || isPaused) return;

    chrome.runtime.sendMessage({
      type: 'RECORD_EVENT',
      payload: {
        ...eventData,
        url: window.location.href
      }
    }).catch((err) => {
      console.warn('Recordation: failed to send event', err);
    });
  }

  // Event handlers
  function handleClick(e) {
    if (isIgnored(e.target)) return;

    // Show visual feedback on screen
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (clientX || clientY) {
      showTapIndicator(clientX, clientY);
    }

    const inspection = window.RecordationSelector.inspectElement(e.target);
    if (!inspection) return;

    const desc = inspection.text 
      ? `Click "${inspection.text}" (${inspection.tag})`
      : `Click ${inspection.selectors.css}`;

    recordEvent({
      type: 'click',
      target: inspection,
      description: desc
    });
  }

  function handleDblClick(e) {
    if (isIgnored(e.target)) return;
    const inspection = window.RecordationSelector.inspectElement(e.target);
    if (!inspection) return;

    recordEvent({
      type: 'dblclick',
      target: inspection,
      description: `Double click on ${inspection.selectors.css}`
    });
  }

  function handleInput(e) {
    if (isIgnored(e.target)) return;
    const target = e.target;
    if (!target) return;

    // Check if element is an editable form input
    const tag = target.tagName ? target.tagName.toUpperCase() : '';
    const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    if (!isTextInput) return;

    // Don't record on password inputs if user desires, or record masked
    let val = target.isContentEditable ? target.innerText : target.value;

    const inspection = window.RecordationSelector.inspectElement(target);
    if (!inspection) return;

    recordEvent({
      type: 'input',
      target: inspection,
      value: val,
      description: `Type in ${inspection.selectors.id ? '#' + inspection.selectors.id : inspection.selectors.css}`
    });
  }

  function handleChange(e) {
    if (isIgnored(e.target)) return;
    const target = e.target;
    if (!target) return;

    const tag = target.tagName ? target.tagName.toUpperCase() : '';
    const inspection = window.RecordationSelector.inspectElement(target);
    if (!inspection) return;

    if (tag === 'SELECT') {
      const selectedOption = target.options && target.selectedIndex >= 0 ? target.options[target.selectedIndex] : null;
      recordEvent({
        type: 'select',
        target: inspection,
        value: target.value,
        description: `Select "${selectedOption ? selectedOption.text : target.value}" from dropdown`
      });
      return;
    }

    if (target.type === 'checkbox' || target.type === 'radio') {
      recordEvent({
        type: 'change',
        target: inspection,
        value: target.checked,
        description: `${target.checked ? 'Check' : 'Uncheck'} ${inspection.selectors.css}`
      });
      return;
    }

    // Generic change event (e.g. datepicker, color picker)
    if (target.value !== undefined) {
      recordEvent({
        type: 'change',
        target: inspection,
        value: target.value,
        description: `Change value to "${target.value}" on ${inspection.selectors.css}`
      });
    }
  }

  function handleKeyDown(e) {
    if (isIgnored(e.target)) return;

    // Only record special navigation/submit keys
    const specialKeys = ['Enter', 'Tab', 'Escape'];
    if (!specialKeys.includes(e.key)) return;

    const inspection = window.RecordationSelector.inspectElement(e.target);
    if (!inspection) return;

    recordEvent({
      type: 'keydown',
      target: inspection,
      key: e.key,
      description: `Press key "${e.key}" on ${inspection.selectors.css}`
    });
  }

  function handleSubmit(e) {
    if (isIgnored(e.target)) return;
    const inspection = window.RecordationSelector.inspectElement(e.target);
    if (!inspection) return;

    recordEvent({
      type: 'submit',
      target: inspection,
      description: `Submit form ${inspection.selectors.css}`
    });
  }

  function handleScroll() {
    clearTimeout(scrollTimeout);

    scrollTimeout = setTimeout(() => {
      const curX = window.scrollX || window.pageXOffset || 0;
      const curY = window.scrollY || window.pageYOffset || 0;

      // Only record significant scroll movements (> 100px)
      const deltaX = Math.abs(curX - lastScrollPos.x);
      const deltaY = Math.abs(curY - lastScrollPos.y);

      if (deltaX > 100 || deltaY > 100) {
        lastScrollPos = { x: curX, y: curY };
        recordEvent({
          type: 'scroll',
          scroll: { x: Math.round(curX), y: Math.round(curY) },
          description: `Scroll page to (${Math.round(curX)}, ${Math.round(curY)})`
        });
      }
    }, 400);
  }

  // Hook SPA History pushState/replaceState/popstate
  function setupSpaListeners() {
    let lastUrl = window.location.href;

    function checkUrlChange() {
      const curUrl = window.location.href;
      if (curUrl !== lastUrl) {
        lastUrl = curUrl;
        recordEvent({
          type: 'navigate',
          url: curUrl,
          description: `SPA navigation to ${curUrl}`
        });
      }
    }

    window.addEventListener('popstate', checkUrlChange);
    window.addEventListener('hashchange', checkUrlChange);

    // Monkey patch pushState and replaceState in page context
    try {
      const origPush = history.pushState;
      history.pushState = function () {
        const ret = origPush.apply(this, arguments);
        checkUrlChange();
        return ret;
      };

      const origReplace = history.replaceState;
      history.replaceState = function () {
        const ret = origReplace.apply(this, arguments);
        checkUrlChange();
        return ret;
      };
    } catch (e) {}
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    // Use capture phase so listeners fire first
    window.addEventListener('click', handleClick, true);
    window.addEventListener('dblclick', handleDblClick, true);
    window.addEventListener('input', handleInput, true);
    window.addEventListener('change', handleChange, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('submit', handleSubmit, true);
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });

    setupSpaListeners();
  }

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;

    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('dblclick', handleDblClick, true);
    window.removeEventListener('input', handleInput, true);
    window.removeEventListener('change', handleChange, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('submit', handleSubmit, true);
    window.removeEventListener('scroll', handleScroll, true);
  }

  // Handle runtime messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ pong: true, recording: isRecording, paused: isPaused });
      return;
    }

    if (msg.type === 'RECORDING_STATE_CHANGED') {
      isRecording = !!msg.isRecording;
      isPaused = !!msg.isPaused;

      if (isRecording) {
        attachListeners();
        const count = msg.session?.steps?.length || 0;
        window.RecordationHUD.updateState({
          recording: true,
          paused: isPaused,
          count: count,
          lastAction: 'Recording in progress'
        });
      } else {
        detachListeners();
        window.RecordationHUD.updateState({ recording: false });
      }
    }

    if (msg.type === 'STEP_ADDED' || msg.type === 'STEP_UPDATED') {
      if (isRecording) {
        const desc = msg.step?.description || `${msg.step?.type?.toUpperCase()}`;
        window.RecordationHUD.setStepCount(msg.totalSteps, desc);
      }
    }
  });

  // Check initial state from storage on script load
  chrome.runtime.sendMessage({ type: 'GET_STATE' }).then((res) => {
    if (res && res.success && res.data) {
      isRecording = res.data.isRecording;
      isPaused = res.data.isPaused;

      if (isRecording) {
        attachListeners();
        const count = res.data.currentSession?.steps?.length || 0;
        const lastStep = res.data.currentSession?.steps?.[count - 1];
        const lastAction = lastStep?.description || 'Recording in progress';

        window.RecordationHUD.updateState({
          recording: true,
          paused: isPaused,
          count: count,
          lastAction: lastAction
        });
      }
    }
  }).catch(() => {});

})();
