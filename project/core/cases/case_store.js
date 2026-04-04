// =====================================================================
// core/cases/case_store.js - إدارة الحالات (Case Store)
// المرجع: Master Plan v1.0 - 5 أبريل 2026
// المبادئ: currentCase.data هو مصدر الحقيقة، Additive Only
// =====================================================================

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// =====================================================================
// التكوين الأساسي
// =====================================================================
const DATA_DIR = path.join(process.cwd(), 'data');
const CASES_DIR = path.join(DATA_DIR, 'cases');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');
const META_FILE = path.join(CASES_DIR, '_meta.json');

// التأكد من وجود المجلدات الأساسية
async function ensureDirectories() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(CASES_DIR, { recursive: true });
    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
}

// =====================================================================
// دوال مساعدة (Helper Functions)
// =====================================================================

// توليد معرف فريد للحالة الجديدة
function generateCaseId() {
    return `CASE-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// الحصول على مسار ملف الحالة
function getCaseFilePath(caseId) {
    return path.join(CASES_DIR, `${caseId}.json`);
}

// الحصول على مسار مجلد مرفقات الحالة
function getCaseAttachmentsDir(caseId) {
    return path.join(ATTACHMENTS_DIR, caseId);
}

// قراءة ملف الميتا (قائمة بجميع الحالات وبياناتها الأساسية)
async function readMeta() {
    try {
        const data = await fs.readFile(META_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // إذا كان الملف غير موجود أو تالف، نعيد هيكل فارغ
        return { cases: [], lastUpdated: null };
    }
}

// كتابة ملف الميتا
async function writeMeta(meta) {
    meta.lastUpdated = new Date().toISOString();
    await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

// تحديث الميتا بعد إضافة/حذف حالة
async function updateMetaForCase(caseObj, isDelete = false) {
    const meta = await readMeta();
    const caseId = caseObj.caseId || caseObj.id;
    
    // استخراج البيانات الأساسية للميتا (بدون تفاصيل كبيرة)
    const caseMeta = {
        caseId: caseId,
        caseNo: caseObj.data?.caseNo || caseObj.caseNo || '',
        fullName: caseObj.data?.fullName || caseObj.fullName || '',
        phone: caseObj.data?.phone || caseObj.phone || '',
        city: caseObj.data?.city || caseObj.city || '',
        status: caseObj.data?.status || caseObj.status || 'new',
        priority: caseObj.data?.priority || caseObj.priority || 'medium',
        createdAt: caseObj.createdAt || caseObj.data?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (isDelete) {
        // حذف من الميتا
        meta.cases = meta.cases.filter(c => c.caseId !== caseId);
    } else {
        // البحث عن الحالة في الميتا
        const existingIndex = meta.cases.findIndex(c => c.caseId === caseId);
        if (existingIndex !== -1) {
            // تحديث الحالة الموجودة
            meta.cases[existingIndex] = { ...meta.cases[existingIndex], ...caseMeta };
        } else {
            // إضافة حالة جديدة
            meta.cases.push(caseMeta);
        }
    }
    
    await writeMeta(meta);
}

// =====================================================================
// الوظائف الأساسية (Core Functions) - API العام للنظام
// =====================================================================

/**
 * حفظ حالة جديدة أو تحديث حالة موجودة
 * @param {Object} caseObj - كائن الحالة الكامل (يجب أن يحتوي على caseId للموجودات)
 * @returns {Promise<Object>} - الحالة المحفوظة
 */
async function saveCase(caseObj) {
    await ensureDirectories();
    
    // التأكد من وجود بنية البيانات الأساسية
    if (!caseObj.data) {
        // إذا لم يكن هناك data، نعتبر أن caseObj نفسه هو data
        caseObj = {
            caseId: caseObj.caseId || generateCaseId(),
            data: caseObj,
            createdAt: caseObj.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    } else {
        // تحديث وقت التعديل
        caseObj.updatedAt = new Date().toISOString();
        if (!caseObj.caseId) {
            caseObj.caseId = generateCaseId();
        }
        if (!caseObj.createdAt) {
            caseObj.createdAt = new Date().toISOString();
        }
    }
    
    // التأكد من وجود معرف
    const caseId = caseObj.caseId;
    const filePath = getCaseFilePath(caseId);
    
    // حفظ الملف
    await fs.writeFile(filePath, JSON.stringify(caseObj, null, 2), 'utf8');
    
    // تحديث الميتا
    await updateMetaForCase(caseObj);
    
    console.log(`[CaseStore] تم حفظ الحالة: ${caseId}`);
    return caseObj;
}

/**
 * تحميل حالة بناءً على المعرف
 * @param {string} id - معرف الحالة
 * @returns {Promise<Object|null>} - كائن الحالة أو null إذا لم توجد
 */
async function getCase(id) {
    await ensureDirectories();
    const filePath = getCaseFilePath(id);
    
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const caseObj = JSON.parse(data);
        console.log(`[CaseStore] تم تحميل الحالة: ${id}`);
        return caseObj;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[CaseStore] الحالة غير موجودة: ${id}`);
            return null;
        }
        console.error(`[CaseStore] خطأ في تحميل الحالة ${id}:`, error);
        throw error;
    }
}

/**
 * الحصول على قائمة بجميع الحالات (بيانات أساسية فقط للميتا)
 * @param {Object} filters - فلترة اختيارية { status, priority, search }
 * @returns {Promise<Array>} - قائمة الحالات
 */
async function getAllCases(filters = {}) {
    await ensureDirectories();
    const meta = await readMeta();
    let cases = [...meta.cases];
    
    // تطبيق الفلاتر
    if (filters.status) {
        cases = cases.filter(c => c.status === filters.status);
    }
    if (filters.priority) {
        cases = cases.filter(c => c.priority === filters.priority);
    }
    if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        cases = cases.filter(c => 
            c.fullName.toLowerCase().includes(searchTerm) ||
            c.caseNo.toLowerCase().includes(searchTerm) ||
            c.phone.includes(searchTerm)
        );
    }
    
    // ترتيب حسب تاريخ التحديث (الأحدث أولاً)
    cases.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    console.log(`[CaseStore] تم جلب ${cases.length} حالة`);
    return cases;
}

/**
 * حذف حالة ومرفقاتها
 * @param {string} id - معرف الحالة
 * @returns {Promise<boolean>} - true إذا تم الحذف بنجاح
 */
async function deleteCase(id) {
    await ensureDirectories();
    const filePath = getCaseFilePath(id);
    const attachmentsDir = getCaseAttachmentsDir(id);
    
    try {
        // تحميل الحالة قبل الحذف لتحديث الميتا
        const caseObj = await getCase(id);
        if (!caseObj) {
            console.log(`[CaseStore] محاولة حذف حالة غير موجودة: ${id}`);
            return false;
        }
        
        // حذف ملف الحالة
        await fs.unlink(filePath);
        
        // حذف مجلد المرفقات إذا كان موجوداً
        try {
            await fs.rm(attachmentsDir, { recursive: true, force: true });
        } catch (e) {
            // تجاهل الأخطاء إذا لم يكن المجلد موجوداً
            console.log(`[CaseStore] لا يوجد مرفقات للحالة ${id}`);
        }
        
        // تحديث الميتا (حذف من القائمة)
        await updateMetaForCase(caseObj, true);
        
        console.log(`[CaseStore] تم حذف الحالة: ${id}`);
        return true;
    } catch (error) {
        console.error(`[CaseStore] خطأ في حذف الحالة ${id}:`, error);
        throw error;
    }
}

/**
 * حفظ مرفق لحالة معينة
 * @param {string} caseId - معرف الحالة
 * @param {string} fileName - اسم الملف
 * @param {Buffer|string} fileContent - محتوى الملف (Buffer أو مسار)
 * @returns {Promise<string>} - مسار المرفق المحفوظ
 */
async function saveAttachment(caseId, fileName, fileContent) {
    await ensureDirectories();
    const attachmentsDir = getCaseAttachmentsDir(caseId);
    await fs.mkdir(attachmentsDir, { recursive: true });
    
    // تنظيف اسم الملف
    const safeFileName = fileName.replace(/[^a-zA-Z0-9\u0600-\u06FF\-_.]/g, '_');
    const filePath = path.join(attachmentsDir, safeFileName);
    
    // إذا كان fileContent مساراً، ننسخ الملف
    if (typeof fileContent === 'string' && (fileContent.startsWith('/') || fileContent.includes(':'))) {
        await fs.copyFile(fileContent, filePath);
    } else {
        // وإلا نكتب المحتوى مباشرة
        await fs.writeFile(filePath, fileContent);
    }
    
    console.log(`[CaseStore] تم حفظ مرفق ${safeFileName} للحالة ${caseId}`);
    return filePath;
}

/**
 * حذف مرفق معين
 * @param {string} caseId - معرف الحالة
 * @param {string} fileName - اسم الملف
 * @returns {Promise<boolean>}
 */
async function deleteAttachment(caseId, fileName) {
    const filePath = path.join(getCaseAttachmentsDir(caseId), fileName);
    try {
        await fs.unlink(filePath);
        console.log(`[CaseStore] تم حذف مرفق ${fileName} للحالة ${caseId}`);
        return true;
    } catch (error) {
        console.error(`[CaseStore] خطأ في حذف المرفق:`, error);
        return false;
    }
}

/**
 * الحصول على جميع مرفقات حالة معينة
 * @param {string} caseId - معرف الحالة
 * @returns {Promise<Array>} - قائمة بأسماء الملفات
 */
async function getAttachments(caseId) {
    const attachmentsDir = getCaseAttachmentsDir(caseId);
    try {
        const files = await fs.readdir(attachmentsDir);
        return files;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

/**
 * تصدير جميع البيانات (للنسخ الاحتياطي)
 * @returns {Promise<Object>} - جميع الحالات والميتا
 */
async function exportAllData() {
    await ensureDirectories();
    const meta = await readMeta();
    const cases = [];
    
    for (const caseMeta of meta.cases) {
        const caseObj = await getCase(caseMeta.caseId);
        if (caseObj) {
            cases.push(caseObj);
        }
    }
    
    return {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        meta: meta,
        cases: cases
    };
}

/**
 * استيراد بيانات (للاستعادة من نسخة احتياطية)
 * @param {Object} exportData - البيانات المصدرة مسبقاً
 * @returns {Promise<number>} - عدد الحالات المستوردة
 */
async function importAllData(exportData) {
    await ensureDirectories();
    
    let importedCount = 0;
    for (const caseObj of exportData.cases) {
        await saveCase(caseObj);
        importedCount++;
    }
    
    console.log(`[CaseStore] تم استيراد ${importedCount} حالة`);
    return importedCount;
}

// =====================================================================
// تصدير الوحدات (CommonJS للاستخدام في Node.js)
// =====================================================================
module.exports = {
    // دوال إدارة الحالات
    saveCase,
    getCase,
    getAllCases,
    deleteCase,
    
    // دوال إدارة المرفقات
    saveAttachment,
    deleteAttachment,
    getAttachments,
    
    // دوال النسخ الاحتياطي
    exportAllData,
    importAllData,
    
    // دوال مساعدة (للاستخدام الداخلي أو المتقدم)
    generateCaseId,
    ensureDirectories
};
