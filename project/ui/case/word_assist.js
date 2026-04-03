// ui/case/word_assist.js
// أداة عرض الملفات بجانب شاشة الحالة

'use strict';

function initWordAssist() {
  const openBtn     = document.getElementById('openWordBtn');
  const closeBtn    = document.getElementById('closeWordBtn');
  const panel       = document.getElementById('wordPanel');
  const frame       = document.getElementById('wordFrame');
  const placeholder = document.getElementById('wordPlaceholder');
  const panelTitle  = document.getElementById('wordPanelTitle');

  if (!openBtn || !panel || !frame) return;

  let isOpen = false;

  openBtn.addEventListener('click', async () => {
    if (isOpen) return;

    if (!window.electronAPI?.selectFile) {
      showStatus('⚠️ الميزة تعمل فقط في تطبيق سطح المكتب');
      return;
    }

    showStatus('⏳ جاري فتح الملف...');

    let filePath;
    try {
      filePath = await window.electronAPI.selectFile();
    } catch {
      showStatus('⚠️ حدث خطأ أثناء فتح الملف');
      return;
    }

    if (!filePath) {
      showStatus('');
      return;
    }

    isOpen = true;
    const name  = filePath.split(/[\\/]/).pop();
    const isPDF = filePath.toLowerCase().endsWith('.pdf');

    if (panelTitle) panelTitle.textContent = name;

    if (isPDF) {
      if (placeholder) placeholder.classList.add('hidden');
      frame.src = `file://${filePath}`;
      _openPanel(panel, openBtn, closeBtn);
      showStatus(`📄 ${name}`);
    } else {
      frame.src = '';
      if (placeholder) placeholder.classList.remove('hidden');
      _openPanel(panel, openBtn, closeBtn);
      try {
        await (window.electronAPI.openFile ?? window.electronAPI.shellOpen)?.(filePath);
      } catch {}
      showStatus(`📝 ${name} — تم الفتح في Word`);
    }

    setTimeout(() => { try { window.focus(); } catch {} }, 500);
  });

  closeBtn.addEventListener('click', () => {
    frame.src = '';
    if (placeholder) placeholder.classList.add('hidden');
    _closePanel(panel, openBtn, closeBtn);
    isOpen = false;
    showStatus('✔ تم إغلاق الأداة');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closeBtn.click();
  });
}

function showStatus(msg) {
  let el = document.getElementById('wordToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wordToast';
    el.className = 'word-toast';
    document.body.appendChild(el);
  }
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg;
  el.style.display = 'block';
  if (el._timeout) clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.display = 'none'; }, 2000);
}

function _openPanel(panel, openBtn, closeBtn) {
  panel.classList.remove('hidden');
  openBtn.style.display  = 'none';
  closeBtn.style.display = 'inline-block';
}

function _closePanel(panel, openBtn, closeBtn) {
  panel.classList.add('hidden');
  openBtn.style.display  = 'inline-block';
  closeBtn.style.display = 'none';
}

if (typeof module !== 'undefined') {
  module.exports = { initWordAssist, showStatus };
} else {
  window.initWordAssist = initWordAssist;
  window.showStatus     = showStatus;
}