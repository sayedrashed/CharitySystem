// core/cards/data_binding.js
// Data Binding Engine

'use strict';

const binding = {
  currentCase: { id: null, data: {} },

  loadCase(caseData) {
    this.currentCase = {
      id: caseData?.id ?? null,
      data: { ...(caseData?.data ?? {}) }
    };
    return this.currentCase;
  },

  newCase() {
    this.currentCase = { id: null, data: {} };
  },

  collectCaseData() {
    return { id: this.currentCase.id, data: { ...this.currentCase.data } };
  },

  setValue(fieldId, value) {
    if (!fieldId) return;
    this.currentCase.data[fieldId] = value;
    // إشعار التطبيق الرئيسي بتغير البيانات
    if (typeof window !== 'undefined' && window.App) {
      window.App.dispatch('data:changed', { fieldId, value });
    }
  },

  getValue(fieldId) {
    return this.currentCase.data[fieldId] ?? '';
  },

  setDefaults(fields = []) {
    fields.forEach(f => {
      if (!(f.id in this.currentCase.data)) {
        this.currentCase.data[f.id] = '';
      }
    });
  },

  // دالة جديدة: ربط الحقول تلقائياً
  bindForm(containerSelector) {
    const container = typeof containerSelector === 'string' 
      ? document.querySelector(containerSelector) 
      : containerSelector;
    if (!container) return;

    // البحث عن جميع الحقول التي تحمل data-field
    const fields = container.querySelectorAll('[data-field]');
    fields.forEach(field => {
      const fieldId = field.getAttribute('data-field');
      if (!fieldId) return;

      // تعيين القيمة الحالية
      const currentValue = this.getValue(fieldId);
      if (field.tagName === 'INPUT' && field.type === 'checkbox') {
        field.checked = currentValue === true || currentValue === 'true';
      } else if (field.tagName === 'SELECT') {
        field.value = currentValue;
      } else {
        field.value = currentValue;
      }

      // إضافة مستمع لتحديث binding عند التغيير
      const eventType = field.tagName === 'SELECT' ? 'change' : 'input';
      field.addEventListener(eventType, (e) => {
        const newValue = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        this.setValue(fieldId, newValue);
      });
    });
  }
};

function renderField(field, data = {}) {
  const value = _esc(data[field.id] ?? '');
  const fid = _esc(field.id);
  const label = _esc(field.label ?? field.id);
  let input = '';
  switch (field.type) {
    case 'number': input = `<input type="number" class="db-input" data-field="${fid}" value="${value}">`; break;
    case 'date': input = `<input type="date" class="db-input" data-field="${fid}" value="${value}">`; break;
    case 'textarea': input = `<textarea class="db-input" data-field="${fid}">${value}</textarea>`; break;
    case 'checkbox': input = `<input type="checkbox" class="db-input" data-field="${fid}" ${data[field.id] ? 'checked' : ''}>`; break;
    case 'select': {
      const opts = (field.options ?? []).map(o => { const sel = String(data[field.id] ?? '') === String(o.value ?? o) ? 'selected' : ''; const lbl = o.label ?? o; const val = o.value ?? o; return `<option value="${_esc(val)}" ${sel}>${_esc(lbl)}</option>`; }).join('');
      input = `<select class="db-input" data-field="${fid}">${opts}</select>`;
      break;
    }
    default: input = `<input type="text" class="db-input" data-field="${fid}" value="${value}">`;
  }
  return `<div class="db-field" data-field-id="${fid}"><label class="db-label">${label}</label>${input}</div>`;
}

function renderCard(card, data = {}) {
  if (!card) return '<div class="db-error">بطاقة غير موجودة</div>';
  if (card.mode === 'builder') {
    const fields = card.fields ?? [];
    const html = fields.map(f => renderField(f, data)).join('');
    return `<div class="db-card" data-card-id="${card.id}">${html}</div>`;
  }
  if (card.mode === 'image') {
    const src = card.imagePath ?? '';
    return `<div class="db-card db-card-image" data-card-id="${card.id}">${src ? `<img src="${src}" class="db-card-img" alt="${_esc(card.title)}">` : '<div class="db-no-img">لا توجد صورة</div>'}</div>`;
  }
  if (card.mode === 'html') {
    let tpl = card.htmlTemplate ?? '';
    Object.entries(data).forEach(([k, v]) => { tpl = tpl.replaceAll(`{{${k}}}`, _esc(String(v ?? ''))); });
    return `<div class="db-card db-card-html" data-card-id="${card.id}">${tpl}</div>`;
  }
  return '<div class="db-error">mode غير معروف: ' + card.mode + '</div>';
}

function attachListeners(container, onChangeCallback) {
  if (!container) return;
  container.addEventListener('input', e => {
    const fieldId = e.target.dataset?.field;
    if (!fieldId) return;
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    binding.setValue(fieldId, value);
    if (typeof onChangeCallback === 'function') onChangeCallback(fieldId, value);
  });
  container.addEventListener('change', e => {
    const fieldId = e.target.dataset?.field;
    if (!fieldId || e.target.tagName !== 'SELECT') return;
    binding.setValue(fieldId, e.target.value);
    if (typeof onChangeCallback === 'function') onChangeCallback(fieldId, e.target.value);
  });
}

function _esc(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

if (typeof module !== 'undefined') { 
  module.exports = { binding, renderField, renderCard, attachListeners };
} else { 
  window.DataBinding = { binding, renderField, renderCard, attachListeners };
}
