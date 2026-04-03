// core/app/app_controller.js
// App Controller — Integration Hub
// Single source of truth + Event bus

'use strict';

(function (global) {

// ════════════════════════════════════════════════════════════════
//  Event Bus
// ════════════════════════════════════════════════════════════════

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
}

function on(name, handler) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(name, e => handler(e.detail ?? {}));
  return () => window.removeEventListener(name, handler);
}

// ════════════════════════════════════════════════════════════════
//  Settings
// ════════════════════════════════════════════════════════════════

const _defaultSettings = {
  orgName:        'جمعية الرحمة الخيرية',
  showAssistant:  true,
  showExport:     true,
  showServices:   true,
  theme:          'dark'
};

let _settings = { ..._defaultSettings };

function applySettings(newSettings) {
  Object.assign(_settings, newSettings ?? {});
  dispatch('settings:changed', { settings: { ..._settings } });
}

function getSettings() {
  return { ..._settings };
}

// ════════════════════════════════════════════════════════════════
//  currentCase — Single source of truth
// ════════════════════════════════════════════════════════════════

let _currentCase = { id: null, data: {}, attachments: [], cards: [] };

function _syncWindow() {
  if (typeof window !== 'undefined') {
    window.currentCase = _currentCase;
  }
}

function getCurrentCase() {
  return { ..._currentCase, data: { ..._currentCase.data } };
}

// ════════════════════════════════════════════════════════════════
//  loadCases
// ════════════════════════════════════════════════════════════════

async function loadCases() {
  const store = _getCaseStore();
  let list = [];

  try {
    list = store ? store.getAllCases() : [];
  } catch (err) {
    console.log('[AppController] loadCases-error:', err.message);
  }

  dispatch('cases:loaded', { cases: list });
  return list;
}

// ════════════════════════════════════════════════════════════════
//  openCase
// ════════════════════════════════════════════════════════════════

async function openCase(caseData) {
  if (!caseData) return;

  let full = caseData;
  if (typeof caseData === 'string') {
    const store = _getCaseStore();
    full = store ? store.getCase(caseData) : null;
    if (!full) { console.log('[AppController] openCase: not found ' + caseData); return; }
  }

  _currentCase = {
    id:          full.id          ?? null,
    data:        { ...(full.data ?? {}) },
    attachments: Array.isArray(full.attachments) ? full.attachments.map(a=>({...a})) : [],
    cards:       Array.isArray(full.cards)       ? full.cards : [],
    createdAt:   full.createdAt   ?? Date.now(),
    updatedAt:   full.updatedAt   ?? Date.now()
  };

  _syncWindow();

  const binding = _getBinding();
  if (binding) binding.loadCase(_currentCase);

  if (typeof loadAttachmentsUI === 'function') loadAttachmentsUI();

  dispatch('case:opened', { case: getCurrentCase() });
}

// ════════════════════════════════════════════════════════════════
//  newCase
// ════════════════════════════════════════════════════════════════

function newCase() {
  _currentCase = { id: null, data: {}, attachments: [], cards: [] };
  _syncWindow();

  const binding = _getBinding();
  if (binding) binding.newCase();

  if (typeof loadAttachmentsUI === 'function') loadAttachmentsUI();

  dispatch('case:new', {});
}

// ════════════════════════════════════════════════════════════════
//  saveCase
// ════════════════════════════════════════════════════════════════

async function saveCase(options = {}) {
  const binding = _getBinding();
  if (binding) {
    const collected = binding.collectCaseData();
    Object.assign(_currentCase.data, collected.data ?? {});
    if (collected.id && !_currentCase.id) _currentCase.id = collected.id;
  }

  if (typeof window !== 'undefined' && window.currentCase?.attachments) {
    _currentCase.attachments = window.currentCase.attachments;
  }

  const store = _getCaseStore();
  let saved = { ..._currentCase, updatedAt: Date.now() };

  if (store) {
    try { saved = store.saveCase(_currentCase); }
    catch (err) { console.log('[AppController] saveCase-error:', err.message); }
  }

  _currentCase = { ...saved };
  _syncWindow();

  dispatch('case:saved', { case: getCurrentCase() });

  await loadCases();

  return saved;
}

// ════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════

function _getCaseStore() {
  if (typeof window !== 'undefined' && window.caseStore) return window.caseStore;
  try { return require('../cases/case_store'); } catch {}
  return null;
}

function _getBinding() {
  if (typeof window !== 'undefined' && window.DataBinding?.binding)
    return window.DataBinding.binding;
  return null;
}

function _log(action, detail) {
  console.log('[AppController]', action, detail ?? '');
}

// ════════════════════════════════════════════════════════════════
//  Public API
// ════════════════════════════════════════════════════════════════

const App = {
  get currentCase() { return getCurrentCase(); },
  loadCases,
  openCase,
  newCase,
  saveCase,
  applySettings,
  getSettings,
  dispatch,
  on,
};

if (typeof module !== 'undefined') {
  module.exports = App;
} else {
  global.App = App;
}

})(typeof globalThis !== 'undefined' ? globalThis : this);