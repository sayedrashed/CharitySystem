// =====================================================================
// core/cases/case_store.js
// إدارة وتخزين بيانات الحالات - Case Store
// المرجع: PROJECT_CONTEXT.txt
// المبادئ: currentCase.data هو مصدر الحقيقة، Additive Only
// المهام:
// 1. حفظ الحالات في ملفات JSON منفصلة
// 2. استرجاع الحالات
// 3. البحث عن الحالات
// 4. حذف الحالات (Soft Delete)
// 5. إدارة الأرقام التسلسلية (م.ع و م.م)
// 6. إدارة المرفقات
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
const SERIAL_FILE = path.join(DATA_DIR, 'serial_numbers.json');

// =====================================================================
// دوال مساعدة (Helper Functions)
// =====================================================================

async function ensureDirectories() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(CASES_DIR, { recursive: true });
    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
}

function generateCaseId() {
    return `CASE-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function getCaseFilePath(caseId) {
    return path.join(CASES_DIR, `${caseId}.json`);
}

function getCaseAttachmentsDir(caseId) {
    return path.join(ATTACHMENTS_DIR, caseId);
}

// =====================================================================
// إدارة الأرقام التسلسلية (م.ع و م.م)
// =====================================================================

async function readSerialNumbers() {
    try {
        const data = await fs.readFile(SERIAL_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {
            global: { lastUsed: 0, recycled: [] },
            accounting: {
                شبرا: { lastUsed: 0, recycled: [] },
                النهضة: { lastUsed: 0, recycled: [] },
                معاقين: { lastUsed: 0, recycled: [] },
                الشركة: { lastUsed: 0, recycled: [] }
            }
        };
    }
}

async function saveSerialNumbers(serials) {
    await fs.writeFile(SERIAL_FILE, JSON.stringify(serials, null, 2), 'utf8');
}

async function getNextGlobalSerial() {
    const serials = await readSerialNumbers();
    
    // استخدام رقم معاد تدويره أولاً
    if (serials.global.recycled.length > 0) {
        const recycled = serials.global.recycled.shift();
        await saveSerialNumbers(serials);
        return recycled;
    }
    
    // وإلا استخدم الرقم التالي
    serials.global.lastUsed += 1;
    await saveSerialNumbers(serials);
    return serials.global.lastUsed;
}

async function getNextAccountingSerial(category) {
    const serials = await readSerialNumbers();
    const catData = serials.accounting[category];
    
    if (!catData) {
        throw new Error(`الفئة ${category} غير معروفة`);
    }
    
    // استخدام رقم معاد تدويره أولاً
    if (catData.recycled.length > 0) {
        const recycled = catData.recycled.shift();
        await saveSerialNumbers(serials);
        return recycled;
    }
    
    // وإلا استخدم الرقم التالي
    catData.lastUsed += 1;
    await saveSerialNumbers(serials);
    return catData.lastUsed;
}

async function releaseGlobalSerial(serialNumber) {
    const serials = await readSerialNumbers();
    serials.global.recycled.push(serialNumber);
    serials.global.recycled.sort((a, b) => a - b);
    await saveSerialNumbers(serials);
}

async function releaseAccountingSerial(category, serialNumber) {
    const serials = await readSerialNumbers();
    if (serials.accounting[category]) {
        serials.accounting[category].recycled.push(serialNumber);
        serials.accounting[category].recycled.sort((a, b) => a - b);
        await saveSerialNumbers(serials);
    }
}

// =====================================================================
// إدارة الميتا (قائمة بجميع الحالات)
// =====================================================================

async function readMeta() {
    try {
        const data = await fs.readFile(META_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { cases: [], lastUpdated: null };
    }
}

async function writeMeta(meta) {
    meta.lastUpdated = new Date().toISOString();
    await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf8');
}

async function updateMetaForCase(caseObj, isDelete = false) {
    const meta = await readMeta();
    const caseId = caseObj.caseId || caseObj.id;
    
    const caseMeta = {
        caseId: caseId,
        caseSerial: caseObj.data?.caseSerial || caseObj.caseSerial || '',
        caseMM: caseObj.data?.caseMM || caseObj.caseMM || '',
        fullName: caseObj.data?.fullName || caseObj.fullName || '',
        phone: caseObj.data?.phone || caseObj.phone || '',
        category: caseObj.data?.category || caseObj.category || '',
        status: caseObj.data?.status || caseObj.status || 'new',
        priority: caseObj.data?.priority || caseObj.priority || 'medium',
        createdAt: caseObj.createdAt || caseObj.data?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (isDelete) {
        meta.cases = meta.cases.filter(c => c.caseId !== caseId);
    } else {
        const existingIndex = meta.cases.findIndex(c => c.caseId === caseId);
        if (existingIndex !== -1) {
            meta.cases[existingIndex] = { ...meta.cases[existingIndex], ...caseMeta };
        } else {
            meta.cases.push(caseMeta);
        }
    }
    
    await writeMeta(meta);
}

// =====================================================================
// الوظائف الأساسية (Core Functions)
// =====================================================================

async function saveCase(caseObj) {
    await ensureDirectories();
    
    if (!caseObj.data) {
        caseObj = {
            caseId: caseObj.caseId || generateCaseId(),
            data: caseObj,
            createdAt: caseObj.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    } else {
        caseObj.updatedAt = new Date().toISOString();
        if (!caseObj.caseId) {
            caseObj.caseId = generateCaseId();
        }
        if (!caseObj.createdAt) {
            caseObj.createdAt = new Date().toISOString();
        }
    }
    
    const caseId = caseObj.caseId;
    const filePath = getCaseFilePath(caseId);
    
    await fs.writeFile(filePath, JSON.stringify(caseObj, null, 2), 'utf8');
    await updateMetaForCase(caseObj);
    
    console.log(`[CaseStore] تم حفظ الحالة: ${caseId}`);
    return caseObj;
}

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

async function getAllCases(filters = {}) {
    await ensureDirectories();
    const meta = await readMeta();
    let cases = [...meta.cases];
    
    if (filters.status) {
        cases = cases.filter(c => c.status === filters.status);
    }
    if (filters.priority) {
        cases = cases.filter(c => c.priority === filters.priority);
    }
    if (filters.category) {
        cases = cases.filter(c => c.category === filters.category);
    }
    if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        cases = cases.filter(c => 
            c.fullName.toLowerCase().includes(searchTerm) ||
            c.caseSerial.toLowerCase().includes(searchTerm) ||
            c.phone.includes(searchTerm)
        );
    }
    
    cases.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    console.log(`[CaseStore] تم جلب ${cases.length} حالة`);
    return cases;
}

async function deleteCase(id, permanent = false) {
    await ensureDirectories();
    const filePath = getCaseFilePath(id);
    const attachmentsDir = getCaseAttachmentsDir(id);
    
    try {
        const caseObj = await getCase(id);
        if (!caseObj) {
            console.log(`[CaseStore] محاولة حذف حالة غير موجودة: ${id}`);
            return false;
        }
        
        if (permanent) {
            // حذف دائم
            await fs.unlink(filePath);
            try {
                await fs.rm(attachmentsDir, { recursive: true, force: true });
            } catch (e) {}
            await updateMetaForCase(caseObj, true);
            
            // تحرير الأرقام التسلسلية
            if (caseObj.data?.caseSerial) {
                await releaseGlobalSerial(parseInt(caseObj.data.caseSerial));
            }
            if (caseObj.data?.caseMM && caseObj.data?.category) {
                await releaseAccountingSerial(caseObj.data.category, parseInt(caseObj.data.caseMM));
            }
        } else {
            // Soft Delete - تحديث الحالة فقط
            caseObj.data = caseObj.data || {};
            caseObj.data.status = 'ملغاة';
            caseObj.data.isDeleted = true;
            caseObj.updatedAt = new Date().toISOString();
            await fs.writeFile(filePath, JSON.stringify(caseObj, null, 2), 'utf8');
            await updateMetaForCase(caseObj);
        }
        
        console.log(`[CaseStore] تم حذف الحالة: ${id} (${permanent ? 'دائم' : 'soft'})`);
        return true;
    } catch (error) {
        console.error(`[CaseStore] خطأ في حذف الحالة ${id}:`, error);
        throw error;
    }
}

async function saveAttachment(caseId, fileName, fileContent) {
    await ensureDirectories();
    const attachmentsDir = getCaseAttachmentsDir(caseId);
    await fs.mkdir(attachmentsDir, { recursive: true });
    
    const safeFileName = fileName.replace(/[^a-zA-Z0-9\u0600-\u06FF\-_.]/g, '_');
    const filePath = path.join(attachmentsDir, safeFileName);
    
    if (typeof fileContent === 'string' && (fileContent.startsWith('/') || fileContent.includes(':'))) {
        await fs.copyFile(fileContent, filePath);
    } else {
        await fs.writeFile(filePath, fileContent);
    }
    
    console.log(`[CaseStore] تم حفظ مرفق ${safeFileName} للحالة ${caseId}`);
    return filePath;
}

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

async function searchCases(query, filters = {}) {
    const allCases = await getAllCases();
    const lowerQuery = query.toLowerCase();
    
    return allCases.filter(c => 
        c.fullName.toLowerCase().includes(lowerQuery) ||
        c.caseSerial.toLowerCase().includes(lowerQuery) ||
        c.phone.includes(query)
    );
}

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
        version: '2.0.0',
        meta: meta,
        cases: cases,
        serials: await readSerialNumbers()
    };
}

async function importAllData(exportData) {
    await ensureDirectories();
    
    let importedCount = 0;
    for (const caseObj of exportData.cases) {
        await saveCase(caseObj);
        importedCount++;
    }
    
    if (exportData.serials) {
        await saveSerialNumbers(exportData.serials);
    }
    
    console.log(`[CaseStore] تم استيراد ${importedCount} حالة`);
    return importedCount;
}

// =====================================================================
// تصدير الوحدات
// =====================================================================

module.exports = {
    // دوال إدارة الحالات
    saveCase,
    getCase,
    getAllCases,
    deleteCase,
    searchCases,
    
    // دوال إدارة الأرقام التسلسلية
    getNextGlobalSerial,
    getNextAccountingSerial,
    releaseGlobalSerial,
    releaseAccountingSerial,
    
    // دوال إدارة المرفقات
    saveAttachment,
    deleteAttachment,
    getAttachments,
    
    // دوال النسخ الاحتياطي
    exportAllData,
    importAllData,
    
    // دوال مساعدة
    generateCaseId,
    ensureDirectories
};
