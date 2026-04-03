// core/attachments/attachments_engine.js
// نظام المرفقات

'use strict';

const PAGE_SIZE = 6;
const VIRTUAL_THRESH = 50;
const WARN_SOFT = 20;
const WARN_HARD = 50;
const MAX_BYTES = 5 * 1024 * 1024;
const THUMB_MAX = 300;
const ORIG_MAX = 1200;

const ATT_TYPES = [
  { id: 'case_photo', label: '📷 صورة حالة' },
  { id: 'receipt',    label: '🧾 إيصال' },
  { id: 'document',   label: '📄 مستند' },
  { id: 'other',      label: '📎 أخرى' }
];

let _filterQuery = '';
let _filterType = '';
let _sortMode = 'newest';
let _selectedNames = new Set();
let _ovIndex = 0;
let _dragSrc = null;

function initSmartAttachments() {
  _buildToolbar();
  _bindDrop();
  _bindOverlay();
  loadAttachmentsUI();
}

function _buildToolbar() {
  const section = document.getElementById('attachmentsSection');
  if (!section || document.getElementById('attToolbar')) return;

  const tb = document.createElement('div');
  tb.id = 'attToolbar';
  tb.className = 'att-toolbar';
  tb.innerHTML = `
    <select id="attTypeSelect" class="att-select" title="نوع المرفق">${ATT_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select>
    <input id="attSearch" class="att-search" placeholder="🔍 بحث...">
    <select id="attSort" class="att-select" title="ترتيب"><option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option><option value="type">حسب النوع</option><option value="manual">يدوي</option></select>
    <span id="attCounter" class="att-counter"></span>
    <button id="attBulkSel" class="att-bulk-del" style="background:#EFF6FF;color:#2563EB;border-color:#BFDBFE">☑ تحديد</button>
    <button id="attBulkDelSel" class="att-bulk-del" style="display:none">🗑 حذف المحدد</button>
  `;

  const dz = document.getElementById('dropZone');
  if (dz) section.insertBefore(tb, dz);
  else section.prepend(tb);

  document.getElementById('attSearch').addEventListener('input', e => { _filterQuery = e.target.value.trim().toLowerCase(); _renderFiltered(); });
  document.getElementById('attSort').addEventListener('change', e => { _sortMode = e.target.value; _renderFiltered(); });
  document.getElementById('attBulkSel').addEventListener('click', _toggleBulkMode);
  document.getElementById('attBulkDelSel').addEventListener('click', _deleteSelected);
}

function loadAttachmentsUI() {
  _selectedNames.clear();
  _renderFiltered();
  _updateMeta();
  if (typeof updateProgress === 'function') updateProgress();
}

function _updateMeta() {
  const count = window.currentCase?.attachments?.length ?? 0;
  const ctr = document.getElementById('attCounter');
  if (ctr) ctr.textContent = '📎 المرفقات (' + count + ')';
  const btn = document.getElementById('attBulkDel');
  if (btn) btn.style.display = count > 0 ? '' : 'none';
}

function _getFiltered() {
  const all = window.currentCase?.attachments ?? [];
  let list = all.filter(f => {
    const nm = !_filterQuery || (f.name ?? '').toLowerCase().includes(_filterQuery);
    const tp = !_filterType || f.type === _filterType;
    return nm && tp;
  });
  const sorted = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (_sortMode === 'newest') return sorted.slice().reverse();
  else if (_sortMode === 'oldest') return sorted;
  else if (_sortMode === 'type') return sorted.sort((a,b) => (a.type||'').localeCompare(b.type||''));
  return sorted;
}

function _renderFiltered() {
  const container = document.getElementById('attachmentsPreview');
  if (!container) return;
  if (container._obs) { container._obs.disconnect(); container._obs = null; }
  container.innerHTML = '';
  const list = _getFiltered();
  if (!list.length) { container.innerHTML = '<div style="color:#94A3B8;font-size:12px;padding:8px">لا توجد مرفقات</div>'; return; }
  if (list.length > VIRTUAL_THRESH) _renderVirtual(container, list);
  else _renderPage(container, list, 0);
}

function _renderPage(container, list, from) {
  const to = Math.min(from + PAGE_SIZE, list.length);
  const frag = document.createDocumentFragment();
  for (let i = from; i < to; i++) { const sk = document.createElement('div'); sk.className = 'att-skeleton'; sk.style.cssText = 'width:110px;height:110px;border-radius:8px;display:inline-block;margin:4px'; frag.appendChild(sk); }
  container.appendChild(frag);
  requestAnimationFrame(() => {
    const skeletons = [...container.querySelectorAll('.att-skeleton')];
    const real = document.createDocumentFragment();
    for (let i = from; i < to; i++) real.appendChild(_buildSmartEl(list[i]));
    skeletons.forEach(s => s.remove());
    container.appendChild(real);
    if (to < list.length) {
      const btn = document.createElement('div');
      btn.className = 'att-show-more';
      btn.id = 'attShowMore';
      btn.textContent = '+ ' + (list.length - to) + ' أخرى';
      btn.onclick = () => { btn.remove(); _renderPage(container, list, to); };
      container.appendChild(btn);
    }
  });
}

function _renderVirtual(container, list) {
  _renderPage(container, list, 0);
  const sentinel = document.createElement('div');
  sentinel.id = 'attSentinel';
  container.appendChild(sentinel);
  const obs = new IntersectionObserver(entries => { if (entries[0].isIntersecting) { const btn = document.getElementById('attShowMore'); if (btn) btn.click(); } }, { rootMargin: '300px' });
  obs.observe(sentinel);
  container._obs = obs;
}

function _buildSmartEl(file) {
  const div = document.createElement('div');
  div.className = 'attachment-item';
  div.dataset.name = file.name;
  div.dataset.id = file.id ?? '';
  div.setAttribute('draggable', 'true');
  const thumbSrc = file.thumbPath ? `file://${file.thumbPath}` : (file.thumb?.path ? `file://${file.thumb.path}` : (file.path ? `file://${file.path}` : (file.url ?? '')));
  const typeLabel = ATT_TYPES.find(t => t.id === file.type)?.label ?? '';
  const mainBadge = file.isMain ? '<div class="att-main-badge">★ رئيسية</div>' : '';
  div.innerHTML = `<div class="att-check-wrap" style="display:none"><input type="checkbox" class="att-checkbox"></div><img src="${thumbSrc}" alt="${file.name}" loading="lazy" style="cursor:pointer;width:110px;height:110px;object-fit:cover;border-radius:8px;display:block" title="${file.name}">${typeLabel ? `<div class="att-type-badge">${typeLabel}</div>` : ''}${mainBadge}<button class="remove-btn" title="حذف">✕</button>`;
  div.querySelector('img').addEventListener('click', () => { if (document.body.classList.contains('att-bulk')) div.querySelector('.att-checkbox').click(); else _openOverlay(file); });
  div.querySelector('.att-checkbox').addEventListener('change', e => { e.target.checked ? _selectedNames.add(file.name) : _selectedNames.delete(file.name); _syncBulkDeleteBtn(); });
  div.querySelector('.remove-btn').addEventListener('click', async e => { e.stopPropagation(); await _deleteOne(file, div); });
  _bindDragSort(div);
  return div;
}

async function handleFiles(files) {
  if (!files?.length) return;
  const say = m => { if (typeof showStatus === 'function') showStatus(m); };
  const atts = window.currentCase.attachments ?? [];
  const type = document.getElementById('attTypeSelect')?.value ?? 'case_photo';
  const count = atts.length;
  if (count >= WARN_HARD) say('⚠️ عدد المرفقات كبير (' + count + ') — سيتم عرض تدريجي');
  else if (count >= WARN_SOFT) say('⚠️ عدد المرفقات كبير — يفضل التنظيم');
  for (const file of files) {
    if (!file.type.startsWith('image/')) { say('⚠️ يُقبل الصور فقط: ' + file.name); continue; }
    if (file.size > MAX_BYTES) { say('⚠️ حجم الصورة أكبر من 5MB: ' + file.name); continue; }
    if (atts.some(a => a.name === file.name && a.size === file.size)) { say('⚠️ هذه الصورة مضافة بالفعل: ' + file.name); continue; }
    say('⏳ جاري رفع الصورة...');
    try {
      const [thumbBlob, origBlob] = await Promise.all([resizeImage(file, THUMB_MAX, THUMB_MAX), resizeImage(file, ORIG_MAX, ORIG_MAX)]);
      const caseId = window.currentCase?.id ?? 'new';
      const [thumbSaved, origSaved] = await Promise.all([_saveFile(thumbBlob, file.name, caseId, 'thumb'), _saveFile(origBlob, file.name, caseId, 'original')]);
      const entry = { id: _uid(), name: origSaved.name, type, thumbPath: thumbSaved.path ?? null, originalPath: origSaved.path ?? null, url: origSaved.url ?? null, thumbUrl: thumbSaved.url ?? null, size: file.size, createdAt: Date.now(), order: 0, isMain: atts.length === 0 };
      window.currentCase.attachments.unshift(entry);
      _reorder();
      say('✅ تم رفع ' + entry.name);
    } catch (err) { say('⚠️ خطأ: ' + err.message); }
  }
  loadAttachmentsUI();
}

async function _saveFile(blob, originalName, caseId, subfolder) {
  if (window.electronAPI?.saveAttachment) return await window.electronAPI.saveAttachment({ blob, caseId: String(caseId), subfolder: subfolder ?? '' });
  const url = URL.createObjectURL(blob);
  const name = _sanitizeName(Date.now() + '_' + subfolder + '_' + (originalName || 'img.jpg'));
  return { path: null, url, name };
}

async function _deleteOne(file, div) {
  if (file.url && !file.originalPath) { try { URL.revokeObjectURL(file.url); } catch {} }
  if (file.thumbUrl && !file.thumbPath) { try { URL.revokeObjectURL(file.thumbUrl); } catch {} }
  const paths = [file.originalPath, file.thumbPath].filter(Boolean);
  for (const p of paths) { if (window.electronAPI?.deleteAttachment) await window.electronAPI.deleteAttachment(p).catch(e => console.warn('[SmartAtt] delete warn:', e.message)); }
  window.currentCase.attachments = window.currentCase.attachments.filter(a => a.name !== file.name);
  _reorder();
  div?.remove();
  _selectedNames.delete(file.name);
  _updateMeta();
  if (typeof showStatus === 'function') showStatus('🗑️ تم حذف المرفق');
}

function _reorder() { (window.currentCase.attachments ?? []).forEach((a, i) => { a.order = i; }); }

function _toggleBulkMode() {
  document.body.classList.toggle('att-bulk');
  const on = document.body.classList.contains('att-bulk');
  const btn = document.getElementById('attBulkSel');
  if (btn) btn.textContent = on ? '✕ إلغاء' : '☑ تحديد';
  document.querySelectorAll('.att-check-wrap').forEach(w => { w.style.display = on ? 'block' : 'none'; });
  if (!on) { _selectedNames.clear(); document.querySelectorAll('.att-checkbox').forEach(c => { c.checked = false; }); _syncBulkDeleteBtn(); }
}

function _syncBulkDeleteBtn() { const btn = document.getElementById('attBulkDelSel'); if (btn) btn.style.display = _selectedNames.size > 0 ? '' : 'none'; }

async function _deleteSelected() { if (!_selectedNames.size || !confirm('حذف ' + _selectedNames.size + ' مرفق؟')) return; const names = new Set(_selectedNames); const all = [...window.currentCase.attachments]; for (const f of all) { if (!names.has(f.name)) continue; const el = document.querySelector('.attachment-item[data-name="' + CSS.escape(f.name) + '"]'); await _deleteOne(f, el); } _toggleBulkMode(); }

function _bindDragSort(el) {
  el.addEventListener('dragstart', e => { _dragSrc = el; setTimeout(() => el.classList.add('dragging'), 0); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => { el.classList.remove('dragging', 'drag-over'); _dragSrc = null; _saveOrder(); });
  el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (_dragSrc && _dragSrc !== el) el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drag-over'); if (!_dragSrc || _dragSrc === el) return; const p = el.parentNode; const items = [...p.querySelectorAll('.attachment-item')]; items.indexOf(_dragSrc) < items.indexOf(el) ? p.insertBefore(_dragSrc, el.nextSibling) : p.insertBefore(_dragSrc, el); _saveOrder(); });
}

function _saveOrder() { const container = document.getElementById('attachmentsPreview'); if (!container) return; const names = [...container.querySelectorAll('.attachment-item')].map(el => el.dataset.name); window.currentCase.attachments.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)); _reorder(); }

function _openOverlay(file) {
  const ov = document.getElementById('attOverlay');
  if (!ov) return;
  const visible = _getFiltered();
  _ovIndex = visible.findIndex(a => a.name === file.name);
  if (_ovIndex < 0) _ovIndex = 0;
  _setOverlayImg(_ovIndex, visible);
  ov.classList.add('open');
}

function _setOverlayImg(idx, list) {
  list = list ?? _getFiltered();
  if (!list.length) return;
  _ovIndex = (idx + list.length) % list.length;
  const f = list[_ovIndex];
  const src = f.originalPath ? `file://${f.originalPath}` : (f.path ? `file://${f.path}` : (f.url ?? ''));
  const img = document.getElementById('attOvImg');
  if (img) img.src = src;
}

function _bindOverlay() {
  document.getElementById('attOvClose')?.addEventListener('click', () => document.getElementById('attOverlay')?.classList.remove('open'));
  document.getElementById('attOvPrev')?.addEventListener('click', () => _setOverlayImg(_ovIndex - 1));
  document.getElementById('attOvNext')?.addEventListener('click', () => _setOverlayImg(_ovIndex + 1));
  document.getElementById('attOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
  document.addEventListener('keydown', e => { const ov = document.getElementById('attOverlay'); if (!ov?.classList.contains('open')) return; if (e.key === 'ArrowLeft') _setOverlayImg(_ovIndex - 1); if (e.key === 'ArrowRight') _setOverlayImg(_ovIndex + 1); if (e.key === 'Escape') ov.classList.remove('open'); });
}

function _bindDrop() {
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  if (!dz || !fi) return;
  dz.onclick = () => fi.click();
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
  fi.addEventListener('change', e => { handleFiles(e.target.files); fi.value = ''; });
}

function getFirstAttachmentSrc() {
  const atts = window.currentCase?.attachments ?? [];
  const main = atts.find(a => a.isMain) ?? atts[0];
  if (!main) return null;
  return main.originalPath ? `file://${main.originalPath}` : (main.path ? `file://${main.path}` : (main.url ?? null));
}

function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const img = new Image(), reader = new FileReader();
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.onload = e => { img.src = e.target.result; };
    img.onerror = () => reject(new Error('Image load error'));
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW || h > maxH) { const r = Math.min(maxW/w, maxH/h); w = Math.round(w*r); h = Math.round(h*r); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
    };
    reader.readAsDataURL(file);
  });
}

function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function _sanitizeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120); }

if (typeof module !== 'undefined') { module.exports = { initSmartAttachments, loadAttachmentsUI, handleFiles, getFirstAttachmentSrc }; }
else { window.initSmartAttachments = initSmartAttachments; window.loadAttachmentsUI = loadAttachmentsUI; window.handleFiles = handleFiles; window.getFirstAttachmentSrc = getFirstAttachmentSrc; }