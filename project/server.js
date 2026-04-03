// server.js
// خادم Node.js الرئيسي

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ملف قاعدة البيانات
const DB_FILE = path.join(__dirname, 'data', 'local.db');
const CASES_DIR = path.join(__dirname, 'data', 'cases');
const ATTACHMENTS_DIR = path.join(__dirname, 'data', 'attachments');

// التأكد من وجود المجلدات
if (!fs.existsSync(CASES_DIR)) fs.mkdirSync(CASES_DIR, { recursive: true });
if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

// ============================================================
// API Routes
// ============================================================

// الحصول على جميع الحالات
app.get('/api/cases', (req, res) => {
  try {
    const caseStore = require('./core/cases/case_store');
    const cases = caseStore.getAllCases();
    res.json({ success: true, data: cases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// الحصول على حالة واحدة
app.get('/api/cases/:id', (req, res) => {
  try {
    const caseStore = require('./core/cases/case_store');
    const caseData = caseStore.getCase(req.params.id);
    if (!caseData) {
      return res.status(404).json({ success: false, error: 'الحالة غير موجودة' });
    }
    res.json({ success: true, data: caseData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// حفظ حالة
app.post('/api/cases', (req, res) => {
  try {
    const caseStore = require('./core/cases/case_store');
    const saved = caseStore.saveCase(req.body);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// حذف حالة
app.delete('/api/cases/:id', (req, res) => {
  try {
    const caseStore = require('./core/cases/case_store');
    const deleted = caseStore.deleteCase(req.params.id);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// تقديم الملفات الثابتة
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/modules', express.static(path.join(__dirname, 'modules')));
app.use('/core', express.static(path.join(__dirname, 'core')));
app.use('/ui', express.static(path.join(__dirname, 'ui')));

// ============================================================
// الصفحة الرئيسية
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/user', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user', 'index.html'));
});

// ============================================================
// تشغيل الخادم
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Base directory: ${__dirname}`);
});