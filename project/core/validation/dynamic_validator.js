// core/validation/dynamic_validator.js
// Dynamic Validation Engine

'use strict';

function validateField(field, value) {
  const val = value ?? '';
  const str = String(val).trim();

  if (field.required && !str) {
    return field.message ?? 'هذا الحقل مطلوب';
  }
  if (!str) return null;

  if (field.type === 'number') {
    const num = Number(str);
    if (isNaN(num)) return field.message ?? 'أدخل قيمة رقمية صحيحة';
    if (field.min != null && num < field.min) return `القيمة يجب أن تكون ≥ ${field.min}`;
    if (field.max != null && num > field.max) return `القيمة يجب أن تكون ≤ ${field.max}`;
  }

  if (field.minLength != null && str.length < field.minLength) return `الحد الأدنى ${field.minLength} حروف`;
  if (field.maxLength != null && str.length > field.maxLength) return `الحد الأقصى ${field.maxLength} حرف`;

  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(str)) return field.message ?? 'القيمة غير صحيحة';
    } catch { }
  }
  return null;
}

function validateCard(card, data) {
  const errors = {};
  if (!card?.fields) return errors;
  card.fields.forEach(field => {
    const err = validateField(field, data?.[field.id]);
    if (err) errors[field.id] = err;
  });
  return errors;
}

function validateCase(schema, data) {
  const errors = {};
  const cards = Array.isArray(schema) ? schema : [];
  cards.forEach(card => Object.assign(errors, validateCard(card, data)));
  return errors;
}

function hasErrors(errors) {
  return Object.keys(errors ?? {}).length > 0;
}

function showErrors(errors, container) {
  if (typeof document === 'undefined') return;
  const root = container ?? document;
  clearErrors(root);
  const firstId = Object.keys(errors)[0];
  Object.entries(errors).forEach(([fieldId, msg]) => {
    const el = root.querySelector(`[data-field="${CSS.escape(fieldId)}"]`);
    if (!el) return;
    el.classList.add('db-error-field');
    const div = document.createElement('div');
    div.className = 'db-error-msg';
    div.textContent = msg;
    div.dataset.forField = fieldId;
    el.parentNode.insertBefore(div, el.nextSibling);
  });
  if (firstId) {
    const first = root.querySelector(`[data-field="${CSS.escape(firstId)}"]`);
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearErrors(container) {
  if (typeof document === 'undefined') return;
  const root = container ?? document;
  root.querySelectorAll('.db-error-field').forEach(el => el.classList.remove('db-error-field'));
  root.querySelectorAll('.db-error-msg').forEach(el => el.remove());
}

function clearFieldError(fieldId, container) {
  if (typeof document === 'undefined') return;
  const root = container ?? document;
  const el = root.querySelector(`[data-field="${CSS.escape(fieldId)}"]`);
  if (el) el.classList.remove('db-error-field');
  root.querySelectorAll(`[data-for-field="${CSS.escape(fieldId)}"]`).forEach(m => m.remove());
}

function attachValidationListeners(container) {
  if (typeof document === 'undefined') return;
  const root = container ?? document;
  root.addEventListener('input', e => { const id = e.target.dataset?.field; if (id) clearFieldError(id, root); });
  root.addEventListener('change', e => { const id = e.target.dataset?.field; if (id) clearFieldError(id, root); });
}

function injectValidationCSS() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dv-styles')) return;
  const style = document.createElement('style');
  style.id = 'dv-styles';
  style.textContent = `.db-error-field { border-color: #F87171 !important; background: rgba(248,113,113,.06) !important; } .db-error-msg { font-size: 11px; color: #F87171; margin-top: 3px; }`;
  document.head.appendChild(style);
}

const dynamicValidator = { validateField, validateCard, validateCase, hasErrors, showErrors, clearErrors, clearFieldError, attachValidationListeners, injectValidationCSS };

if (typeof module !== 'undefined') { module.exports = dynamicValidator; }
else { window.DynamicValidator = dynamicValidator; }