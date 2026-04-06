// =====================================================================
// server.js
// خادم Node.js الرئيسي - API وخدمة الملفات الثابتة
// المرجع: PROJECT_CONTEXT.txt
// المهام:
// 1. تقديم الملفات الثابتة (HTML, CSS, JS)
// 2. API للحالات (CRUD)
// 3. API للمزامنة (sync)
// 4. API للنسخ الاحتياطي (backup)
// 5. API للبوتات
// 6. API للطباعة
// =====================================================================

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Middleware
// ============================================================

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// تكوين رفع الملفات
const upload = multer({
    dest: path.join(__dirname, 'data', 'temp'),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ============================================================
// مسارات الملفات
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const CASES_DIR = path.join(DATA_DIR, 'cases');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

// التأكد من وجود المجلدات
function ensureDirectories() {
    const dirs = [DATA_DIR, CASES_DIR, ATTACHMENTS_DIR, BACKUP_DIR, TEMP_DIR];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}
ensureDirectories();

// ============================================================
// API Routes - الحالات (Cases)
// ============================================================

// الحصول على جميع الحالات
app.get('/api/cases', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const filters = {
            status: req.query.status,
            priority: req.query.priority,
            category: req.query.category,
            search: req.query.search
        };
        const cases = await caseStore.getAllCases(filters);
        res.json({ success: true, data: cases });
    } catch (err) {
        console.error('[API] خطأ في جلب الحالات:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// الحصول على حالة واحدة
app.get('/api/cases/:id', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const caseData = await caseStore.getCase(req.params.id);
        if (!caseData) {
            return res.status(404).json({ success: false, error: 'الحالة غير موجودة' });
        }
        res.json({ success: true, data: caseData });
    } catch (err) {
        console.error('[API] خطأ في جلب الحالة:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// حفظ حالة
app.post('/api/cases', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const saved = await caseStore.saveCase(req.body);
        res.json({ success: true, data: saved });
    } catch (err) {
        console.error('[API] خطأ في حفظ الحالة:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// حذف حالة
app.delete('/api/cases/:id', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const permanent = req.query.permanent === 'true';
        const deleted = await caseStore.deleteCase(req.params.id, permanent);
        res.json({ success: true, deleted });
    } catch (err) {
        console.error('[API] خطأ في حذف الحالة:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// البحث في الحالات
app.get('/api/cases/search/:query', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const results = await caseStore.searchCases(req.params.query, req.query);
        res.json({ success: true, data: results });
    } catch (err) {
        console.error('[API] خطأ في البحث:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - المرفقات (Attachments)
// ============================================================

// رفع مرفق
app.post('/api/cases/:id/attachments', upload.single('file'), async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, error: 'لا يوجد ملف للرفع' });
        }
        
        const savedPath = await caseStore.saveAttachment(
            req.params.id,
            file.originalname,
            file.path
        );
        
        res.json({ success: true, data: { path: savedPath, name: file.originalname } });
    } catch (err) {
        console.error('[API] خطأ في رفع المرفق:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// الحصول على مرفقات الحالة
app.get('/api/cases/:id/attachments', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const attachments = await caseStore.getAttachments(req.params.id);
        res.json({ success: true, data: attachments });
    } catch (err) {
        console.error('[API] خطأ في جلب المرفقات:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// حذف مرفق
app.delete('/api/cases/:id/attachments/:filename', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const deleted = await caseStore.deleteAttachment(req.params.id, req.params.filename);
        res.json({ success: true, deleted });
    } catch (err) {
        console.error('[API] خطأ في حذف المرفق:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - المزامنة (Sync)
// ============================================================

// فحص الاتصال
app.get('/api/ping', (req, res) => {
    res.json({ success: true, message: 'pong', timestamp: new Date().toISOString() });
});

// الحصول على وقت الخادم
app.get('/api/time', (req, res) => {
    res.json({ serverTime: new Date().toISOString() });
});

// رفع التغييرات (PUSH)
app.post('/api/sync/push', async (req, res) => {
    try {
        const { deviceId, changes, timestamp } = req.body;
        const caseStore = require('./core/cases/case_store');
        
        let pushedCount = 0;
        for (const change of changes) {
            if (change.type === 'case_update' && change.data) {
                await caseStore.saveCase(change.data);
                pushedCount++;
            }
        }
        
        res.json({ success: true, pushedCount, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[API] خطأ في رفع التغييرات:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// سحب التغييرات (PULL)
app.post('/api/sync/pull', async (req, res) => {
    try {
        const { deviceId, lastSyncAt, timestamp } = req.body;
        const caseStore = require('./core/cases/case_store');
        
        const allCases = await caseStore.getAllCases();
        const changes = allCases.filter(c => {
            if (!lastSyncAt) return true;
            return new Date(c.updatedAt) > new Date(lastSyncAt);
        });
        
        res.json({ success: true, changes, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[API] خطأ في سحب التغييرات:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - النسخ الاحتياطي (Backup)
// ============================================================

// إنشاء نسخة احتياطية
app.post('/api/backup/create', async (req, res) => {
    try {
        const backupManager = require('./core/backup_manager');
        const result = await backupManager.createBackup();
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[API] خطأ في إنشاء النسخة الاحتياطية:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// الحصول على قائمة النسخ الاحتياطية
app.get('/api/backup/list', async (req, res) => {
    try {
        const backupManager = require('./core/backup_manager');
        const backups = await backupManager.listBackups();
        res.json({ success: true, data: backups });
    } catch (err) {
        console.error('[API] خطأ في جلب قائمة النسخ:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// استعادة نسخة احتياطية
app.post('/api/backup/restore', async (req, res) => {
    try {
        const { filename } = req.body;
        const backupManager = require('./core/backup_manager');
        const result = await backupManager.restoreBackup(filename);
        res.json({ success: true, restored: result });
    } catch (err) {
        console.error('[API] خطأ في استعادة النسخة:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - الأرقام التسلسلية (Serials)
// ============================================================

// الحصول على الرقم التسلسلي التالي
app.get('/api/serials/next/:category', async (req, res) => {
    try {
        const caseStore = require('./core/cases/case_store');
        const globalSerial = await caseStore.getNextGlobalSerial();
        const accountingSerial = await caseStore.getNextAccountingSerial(req.params.category);
        res.json({ success: true, data: { global: globalSerial, accounting: accountingSerial } });
    } catch (err) {
        console.error('[API] خطأ في جلب الأرقام التسلسلية:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - البوتات (Bots)
// ============================================================

// الحصول على حالة البوتات
app.get('/api/bots/status', (req, res) => {
    res.json({
        success: true,
        data: {
            main: { status: 'running', name: 'المساعد الذكي' },
            keeper: { status: 'running', name: 'بوت التذكير' },
            workGroup: { status: 'stopped', name: 'بوت جروب العمل' },
            locations: { status: 'stopped', name: 'بوت مواقع الحالات' }
        }
    });
});

// إرسال إشعار للمدير عبر بوت التذكير
app.post('/api/bots/keeper/notify', async (req, res) => {
    try {
        const { message, adminId } = req.body;
        // هنا سيتم الاتصال ببوت التذكير الفعلي
        console.log(`[BOT] إشعار للمدير: ${message}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[API] خطأ في إرسال الإشعار:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// API Routes - النظام (System)
// ============================================================

// إعادة تشغيل النظام
app.post('/api/system/reboot', (req, res) => {
    if (req.headers['x-admin-key'] !== 'admin_secret') {
        return res.status(403).json({ success: false, error: 'غير مصرح' });
    }
    res.json({ success: true, message: 'جاري إعادة تشغيل النظام...' });
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// إيقاف تشغيل النظام
app.post('/api/system/shutdown', (req, res) => {
    if (req.headers['x-admin-key'] !== 'admin_secret') {
        return res.status(403).json({ success: false, error: 'غير مصرح' });
    }
    res.json({ success: true, message: 'جاري إيقاف تشغيل النظام...' });
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// الحصول على حالة النظام
app.get('/api/system/status', (req, res) => {
    res.json({
        success: true,
        data: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version,
            platform: process.platform,
            timestamp: new Date().toISOString()
        }
    });
});

// ============================================================
// API Routes - الطباعة (Printing)
// ============================================================

// الحصول على قائمة الطابعات
app.get('/api/printers/list', (req, res) => {
    // في الإنتاج، سيتم جلب الطابعات الفعلية
    res.json({
        success: true,
        data: [
            { id: 'printer1', name: 'HP LaserJet M402', status: 'ready', type: 'local' },
            { id: 'printer2', name: 'Canon IR-ADV', status: 'ready', type: 'network' }
        ]
    });
});

// طباعة مستند
app.post('/api/print', async (req, res) => {
    try {
        const { content, printerId, options } = req.body;
        // هنا سيتم تنفيذ الطباعة الفعلية
        console.log(`[PRINT] إرسال مستند إلى الطابعة: ${printerId}`);
        res.json({ success: true, message: 'تم إرسال المستند إلى الطابعة' });
    } catch (err) {
        console.error('[API] خطأ في الطباعة:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// تقديم الملفات الثابتة (Static Files)
// ============================================================

// تقديم المجلدات الرئيسية
app.use(express.static(path.join(__dirname, 'public')));
app.use('/modules', express.static(path.join(__dirname, 'modules')));
app.use('/core', express.static(path.join(__dirname, 'core')));
app.use('/ui', express.static(path.join(__dirname, 'ui')));
app.use('/utils', express.static(path.join(__dirname, 'utils')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// ============================================================
// الصفحات الرئيسية
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'user', 'index.html'));
});

// ============================================================
// معالجة الأخطاء (Error Handling)
// ============================================================

// 404 - صفحة غير موجودة
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'الصفحة غير موجودة' });
});

// 500 - خطأ في الخادم
app.use((err, req, res, next) => {
    console.error('[SERVER] خطأ:', err);
    res.status(500).json({ success: false, error: err.message || 'خطأ في الخادم' });
});

// ============================================================
// تشغيل الخادم
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`🚀 خادم Node.js يعمل على:`);
    console.log(`   • http://localhost:${PORT}`);
    console.log(`   • http://0.0.0.0:${PORT}`);
    console.log(`📁 المسار الأساسي: ${__dirname}`);
    console.log(`📋 API متاحة:`);
    console.log(`   • GET  /api/cases - قائمة الحالات`);
    console.log(`   • GET  /api/cases/:id - حالة واحدة`);
    console.log(`   • POST /api/cases - حفظ حالة`);
    console.log(`   • DELETE /api/cases/:id - حذف حالة`);
    console.log(`   • POST /api/sync/push - رفع التغييرات`);
    console.log(`   • POST /api/sync/pull - سحب التغييرات`);
    console.log(`   • POST /api/backup/create - نسخ احتياطي`);
    console.log(`   • GET  /api/backup/list - قائمة النسخ`);
    console.log('='.repeat(50));
});
