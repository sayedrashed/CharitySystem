// core/cases/case_store.js
// Case Persistence System - يدعم JSON files (للتشغيل الفوري) ويمكن تطويره لاحقاً لـ SQLite

'use strict';

// محاولة تحميل fs و path (تعمل في Node.js فقط)
let fs = null;
let path = null;

// التحقق من وجود require (بيئة Node.js)
if (typeof require !== 'undefined') {
  try {
    fs = require('fs');
    path = require('path');
  } catch (e) {
    console.log('[CaseStore] fs/path not available, using localStorage fallback');
  }
}

// استخدام localStorage كبديل في حالة عدم وجود fs (مثل المتصفح العادي)
const USE_LOCAL_STORAGE = !fs || typeof window !== 'undefined';

// الدليل الأساسي لحفظ الملفات (في Node.js)
const BASE_DIR = (typeof __dirname !== 'undefined' && path) 
  ? path.resolve(path.join(__dirname, '../../../data/cases'))
  : null;

function _sanitize(id) { return String(id??'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80); }
function _uid() { return 'case_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function _log(a,d) { console.log('[CaseStore]',a,d??''); }

// ── حفظ في localStorage (للمتصفح) ──
function _saveToLocalStorage(id, data) {
  try {
    const key = `case_${_sanitize(id)}`;
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    _log('error', 'localStorage save: ' + err.message);
    return false;
  }
}

function _getFromLocalStorage(id) {
  try {
    const key = `case_${_sanitize(id)}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    _log('error', 'localStorage get: ' + err.message);
    return null;
  }
}

function _getAllFromLocalStorage() {
  try {
    const cases = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('case_')) {
        const data = JSON.parse(localStorage.getItem(key));
        if (data) {
          cases.push({
            id: data.id,
            name: data.data?.full_name || data.data?.name || 'بدون اسم',
            updatedAt: data.updatedAt || 0,
            createdAt: data.createdAt || 0
          });
        }
      }
    }
    return cases.sort((a,b) => b.updatedAt - a.updatedAt);
  } catch (err) {
    _log('error', 'localStorage getAll: ' + err.message);
    return [];
  }
}

function _deleteFromLocalStorage(id) {
  try {
    const key = `case_${_sanitize(id)}`;
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    _log('error', 'localStorage delete: ' + err.message);
    return false;
  }
}

// ── حفظ في ملفات JSON (لـ Node.js) ──
function _ensureDir() { 
  if (!USE_LOCAL_STORAGE && BASE_DIR && fs && !fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

function _caseFile(id) { 
  return BASE_DIR ? path.join(BASE_DIR, _sanitize(id) + '.json') : null; 
}

function _readFile(p) {
  if (!fs || !p) return null;
  try { 
    if (!fs.existsSync(p)) return null; 
    return JSON.parse(fs.readFileSync(p, 'utf8')); 
  } catch (err) { 
    _log('error', 'readFile: ' + err.message); 
    return null; 
  }
}

// ── saveCase ──
function saveCase(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('caseObj مطلوب');
  const now = Date.now();
  const id = obj.id ? _sanitize(obj.id) : _uid();
  if (!id) throw new Error('caseId غير صالح');
  
  let existing = null;
  if (USE_LOCAL_STORAGE) {
    existing = _getFromLocalStorage(id);
  } else {
    _ensureDir();
    existing = _readFile(_caseFile(id));
  }
  
  const toSave = {
    id,
    data: { ...(obj.data ?? {}) },
    attachments: Array.isArray(obj.attachments) ? obj.attachments : [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  
  if (USE_LOCAL_STORAGE) {
    _saveToLocalStorage(id, toSave);
  } else if (fs && _caseFile(id)) {
    fs.writeFileSync(_caseFile(id), JSON.stringify(toSave, null, 2), 'utf8');
  }
  
  _log('save', id);
  return toSave;
}

// ── getCase ──
function getCase(id) {
  if (!id) return null;
  const safeId = _sanitize(id);
  let result = null;
  
  if (USE_LOCAL_STORAGE) {
    result = _getFromLocalStorage(safeId);
  } else {
    result = _readFile(_caseFile(safeId));
  }
  
  if (result) _log('get', id);
  return result;
}

// ── getAllCases ──
function getAllCases() {
  if (USE_LOCAL_STORAGE) {
    return _getAllFromLocalStorage();
  }
  
  if (!BASE_DIR || !fs) return [];
  _ensureDir();
  try {
    return fs.readdirSync(BASE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const o = _readFile(path.join(BASE_DIR, f));
        if (!o) return null;
        return { 
          id: o.id, 
          name: o.data?.full_name ?? o.data?.name ?? 'بدون اسم',
          updatedAt: o.updatedAt ?? 0, 
          createdAt: o.createdAt ?? 0 
        };
      })
      .filter(Boolean)
      .sort((a,b) => b.updatedAt - a.updatedAt);
  } catch (err) { 
    _log('error', 'getAllCases: ' + err.message); 
    return []; 
  }
}

// ── deleteCase ──
function deleteCase(id) {
  if (!id) return false;
  const safeId = _sanitize(id);
  let deleted = false;
  
  if (USE_LOCAL_STORAGE) {
    deleted = _deleteFromLocalStorage(safeId);
  } else {
    const file = _caseFile(safeId);
    if (fs && file && fs.existsSync(file)) {
      try { 
        fs.unlinkSync(file); 
        deleted = true; 
      } catch (e) { 
        _log('error', 'deleteCase JSON: ' + e.message); 
      }
    }
  }
  
  if (deleted) _log('delete', safeId);
  return deleted;
}

// تصدير الواجهة
if (typeof module !== 'undefined') {
  module.exports = { saveCase, getCase, getAllCases, deleteCase };
} else {
  window.caseStore = { saveCase, getCase, getAllCases, deleteCase };
}
