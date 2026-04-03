// core/cases/case_store.js
// Case Persistence System

'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_DIR = path.resolve(path.join(__dirname, '../../data/cases'));
const ATT_DIR  = path.resolve(path.join(__dirname, '../../data/attachments'));

function _sanitize(id) { return String(id??'').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80); }
function _uid()        { return 'case_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function _ensureDir()  { if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR,{recursive:true}); }
function _caseFile(id) { return path.join(BASE_DIR, _sanitize(id)+'.json'); }
function _log(a,d)     { console.log('[CaseStore]',a,d??''); }

function _readFile(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p,'utf8')); }
  catch (err) { _log('error','readFile: '+err.message); return null; }
}

// ── saveCase ───────────────────────────────────────────────────
function saveCase(obj) {
  _ensureDir();
  if (!obj || typeof obj !== 'object') throw new Error('caseObj مطلوب');
  const now    = Date.now();
  const id     = obj.id ? _sanitize(obj.id) : _uid();
  if (!id) throw new Error('caseId غير صالح');
  const existing = _readFile(_caseFile(id));
  const toSave = {
    id,
    data:        { ...(obj.data ?? {}) },
    attachments: Array.isArray(obj.attachments) ? obj.attachments : [],
    createdAt:   existing?.createdAt ?? now,
    updatedAt:   now
  };
  fs.writeFileSync(_caseFile(id), JSON.stringify(toSave,null,2),'utf8');
  _log('save', id);
  return toSave;
}

// ── getCase ────────────────────────────────────────────────────
function getCase(id) {
  if (!id) return null;
  const result = _readFile(_caseFile(_sanitize(id)));
  if (result) _log('get', id);
  return result;
}

// ── getAllCases ────────────────────────────────────────────────
function getAllCases() {
  _ensureDir();
  try {
    return fs.readdirSync(BASE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const o = _readFile(path.join(BASE_DIR, f));
        if (!o) return null;
        return { id:o.id, name:o.data?.full_name??o.data?.name??'بدون اسم',
                 updatedAt:o.updatedAt??0, createdAt:o.createdAt??0 };
      })
      .filter(Boolean)
      .sort((a,b) => b.updatedAt - a.updatedAt);
  } catch (err) { _log('error','getAllCases: '+err.message); return []; }
}

// ── deleteCase ─────────────────────────────────────────────────
function deleteCase(id) {
  if (!id) return false;
  const safeId = _sanitize(id);
  let deleted  = false;
  const file = _caseFile(safeId);
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); deleted = true; }
    catch (e) { _log('error','deleteCase JSON: '+e.message); }
  }
  const attFolder = path.join(ATT_DIR, safeId);
  if (fs.existsSync(attFolder)) {
    try { fs.rmSync(attFolder,{recursive:true,force:true}); }
    catch (e) { _log('error','deleteCase atts: '+e.message); }
  }
  if (deleted) _log('delete', safeId);
  return deleted;
}

module.exports = { saveCase, getCase, getAllCases, deleteCase };