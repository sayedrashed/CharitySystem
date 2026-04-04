// =====================================================================
// core/app/app_controller.js - المتحكم الرئيسي للتطبيق
// المرجع: Master Plan v1.0 - 5 أبريل 2026
// المبادئ: currentCase.data هو مصدر الحقيقة، Event Bus للإشعارات
// =====================================================================

const EventEmitter = require('events');
const caseStore = require('../cases/case_store');

// =====================================================================
// Event Bus - نظام الإشعارات المركزي
// =====================================================================
class AppEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // زيادة عدد المستمعين المسموح به
    }
    
    // إطلاق حدث تغيير البيانات
    emitDataChange(eventType, data) {
        this.emit('dataChange', { type: eventType, data, timestamp: new Date().toISOString() });
    }
    
    // إطلاق حدث تغيير currentCase
    emitCurrentCaseChanged(caseData) {
        this.emit('currentCaseChanged', caseData);
        this.emitDataChange('currentCaseChanged', caseData);
    }
    
    // إطلاق حدث حفظ الحالة
    emitCaseSaved(caseId) {
        this.emit('caseSaved', caseId);
        this.emitDataChange('caseSaved', { caseId });
    }
    
    // إطلاق حدث حذف الحالة
    emitCaseDeleted(caseId) {
        this.emit('caseDeleted', caseId);
        this.emitDataChange('caseDeleted', { caseId });
    }
    
    // إطلاق حدث خطأ
    emitError(error, context) {
        this.emit('error', { error, context, timestamp: new Date().toISOString() });
    }
}

// =====================================================================
// المتحكم الرئيسي للتطبيق (Singleton)
// =====================================================================
class AppController {
    constructor() {
        // الحالة الحالية (مصدر الحقيقة الوحيد)
        this.currentCase = {
            caseId: null,
            data: {
                // بنية الحالة الأساسية
                caseNo: '',
                fullName: '',
                phone: '',
                nationalId: '',
                address: '',
                city: '',
                status: 'new',      // new, pending, active, closed
                priority: 'medium',  // low, medium, high, critical
                createdAt: null,
                updatedAt: null,
                
                // بيانات البطاقات (سيتم ملؤها من 1.html إلى 8.html)
                personalInfo: {},
                socialStatus: {},
                financialInfo: {},
                healthStatus: {},
                childrenInfo: {},
                housingInfo: {},
                workInfo: {},
                additionalNotes: {}
            },
            createdAt: null,
            updatedAt: null
        };
        
        // Event Bus
        this.eventBus = new AppEventBus();
        
        // مستمعي الأحداث (للواجهة)
        this.listeners = [];
        
        // حالة التحميل
        this.isLoading = false;
        
        // تهيئة المجلدات
        this.init();
    }
    
    // =================================================================
    // التهيئة
    // =================================================================
    async init() {
        try {
            await caseStore.ensureDirectories();
            console.log('[AppController] تم تهيئة المتحكم بنجاح');
        } catch (error) {
            console.error('[AppController] خطأ في التهيئة:', error);
            this.eventBus.emitError(error, 'init');
        }
    }
    
    // =================================================================
    // إدارة الحالة الحالية (currentCase)
    // =================================================================
    
    /**
     * فتح حالة جديدة (مسح البيانات الحالية)
     * @returns {Object} - الحالة الجديدة الفارغة
     */
    newCase() {
        const now = new Date().toISOString();
        this.currentCase = {
            caseId: null,
            data: {
                caseNo: '',
                fullName: '',
                phone: '',
                nationalId: '',
                address: '',
                city: '',
                status: 'new',
                priority: 'medium',
                createdAt: now,
                updatedAt: now,
                personalInfo: {},
                socialStatus: {},
                financialInfo: {},
                healthStatus: {},
                childrenInfo: {},
                housingInfo: {},
                workInfo: {},
                additionalNotes: {}
            },
            createdAt: now,
            updatedAt: now
        };
        
        console.log('[AppController] تم إنشاء حالة جديدة فارغة');
        this.eventBus.emitCurrentCaseChanged(this.currentCase);
        return this.currentCase;
    }
    
    /**
     * فتح حالة موجودة من التخزين
     * @param {string} caseId - معرف الحالة
     * @returns {Promise<Object|null>} - الحالة المفتوحة أو null
     */
    async openCase(caseId) {
        this.isLoading = true;
        this.eventBus.emit('loadingStart', { action: 'openCase', caseId });
        
        try {
            const loadedCase = await caseStore.getCase(caseId);
            
            if (!loadedCase) {
                console.log(`[AppController] الحالة ${caseId} غير موجودة`);
                this.eventBus.emitError(new Error('Case not found'), `openCase:${caseId}`);
                return null;
            }
            
            // تحديث currentCase بالبيانات المحملة
            this.currentCase = {
                caseId: loadedCase.caseId,
                data: loadedCase.data || loadedCase, // التوافق مع البنى المختلفة
                createdAt: loadedCase.createdAt,
                updatedAt: loadedCase.updatedAt
            };
            
            // التأكد من وجود البنية الأساسية للبيانات
            if (!this.currentCase.data.personalInfo) this.currentCase.data.personalInfo = {};
            if (!this.currentCase.data.socialStatus) this.currentCase.data.socialStatus = {};
            if (!this.currentCase.data.financialInfo) this.currentCase.data.financialInfo = {};
            if (!this.currentCase.data.healthStatus) this.currentCase.data.healthStatus = {};
            if (!this.currentCase.data.childrenInfo) this.currentCase.data.childrenInfo = {};
            if (!this.currentCase.data.housingInfo) this.currentCase.data.housingInfo = {};
            if (!this.currentCase.data.workInfo) this.currentCase.data.workInfo = {};
            if (!this.currentCase.data.additionalNotes) this.currentCase.data.additionalNotes = {};
            
            console.log(`[AppController] تم فتح الحالة: ${caseId}`);
            this.eventBus.emitCurrentCaseChanged(this.currentCase);
            return this.currentCase;
            
        } catch (error) {
            console.error('[AppController] خطأ في فتح الحالة:', error);
            this.eventBus.emitError(error, `openCase:${caseId}`);
            return null;
        } finally {
            this.isLoading = false;
            this.eventBus.emit('loadingEnd', { action: 'openCase' });
        }
    }
    
    /**
     * حفظ الحالة الحالية
     * @returns {Promise<Object>} - الحالة المحفوظة
     */
    async saveCase() {
        if (!this.currentCase.data.caseNo || this.currentCase.data.caseNo === '') {
            // إذا لم يكن هناك رقم حالة، نستخدم الوقت الحالي
            const now = new Date();
            this.currentCase.data.caseNo = `CASE-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getTime().toString().slice(-6)}`;
        }
        
        // تحديث وقت التعديل
        const now = new Date().toISOString();
        this.currentCase.updatedAt = now;
        this.currentCase.data.updatedAt = now;
        
        if (!this.currentCase.createdAt) {
            this.currentCase.createdAt = now;
            this.currentCase.data.createdAt = now;
        }
        
        try {
            const savedCase = await caseStore.saveCase(this.currentCase);
            
            // تحديث currentCase بالبيانات المحفوظة (بما في ذلك caseId إذا كان جديداً)
            this.currentCase.caseId = savedCase.caseId;
            this.currentCase.createdAt = savedCase.createdAt;
            
            console.log(`[AppController] تم حفظ الحالة: ${this.currentCase.caseId}`);
            this.eventBus.emitCaseSaved(this.currentCase.caseId);
            this.eventBus.emitCurrentCaseChanged(this.currentCase);
            return savedCase;
            
        } catch (error) {
            console.error('[AppController] خطأ في حفظ الحالة:', error);
            this.eventBus.emitError(error, 'saveCase');
            throw error;
        }
    }
    
    /**
     * حفظ حالة معينة (بدون تغيير currentCase)
     * @param {Object} caseObj - كائن الحالة
     * @returns {Promise<Object>}
     */
    async saveSpecificCase(caseObj) {
        try {
            const savedCase = await caseStore.saveCase(caseObj);
            this.eventBus.emitCaseSaved(savedCase.caseId);
            return savedCase;
        } catch (error) {
            console.error('[AppController] خطأ في حفظ حالة محددة:', error);
            this.eventBus.emitError(error, 'saveSpecificCase');
            throw error;
        }
    }
    
    /**
     * حذف الحالة الحالية
     * @returns {Promise<boolean>}
     */
    async deleteCurrentCase() {
        if (!this.currentCase.caseId) {
            console.log('[AppController] لا توجد حالة حالية للحذف');
            return false;
        }
        
        const caseId = this.currentCase.caseId;
        
        try {
            const result = await caseStore.deleteCase(caseId);
            
            if (result) {
                // إنشاء حالة جديدة فارغة بعد الحذف
                this.newCase();
                this.eventBus.emitCaseDeleted(caseId);
                console.log(`[AppController] تم حذف الحالة: ${caseId}`);
            }
            
            return result;
        } catch (error) {
            console.error('[AppController] خطأ في حذف الحالة:', error);
            this.eventBus.emitError(error, 'deleteCurrentCase');
            throw error;
        }
    }
    
    /**
     * تحديث حقل معين في currentCase.data
     * @param {string} fieldPath - مسار الحقل (مثل 'personalInfo.name')
     * @param {any} value - القيمة الجديدة
     */
    updateField(fieldPath, value) {
        const parts = fieldPath.split('.');
        let target = this.currentCase.data;
        
        // الوصول إلى الحقل المطلوب (إنشاء المسارات الوسيطة إذا لم تكن موجودة)
        for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]]) {
                target[parts[i]] = {};
            }
            target = target[parts[i]];
        }
        
        const lastPart = parts[parts.length - 1];
        const oldValue = target[lastPart];
        target[lastPart] = value;
        
        // تحديث وقت التعديل
        this.currentCase.updatedAt = new Date().toISOString();
        this.currentCase.data.updatedAt = this.currentCase.updatedAt;
        
        console.log(`[AppController] تحديث الحقل: ${fieldPath} =`, value);
        
        // إطلاق حدث تحديث الحقل
        this.eventBus.emit('fieldUpdated', { fieldPath, oldValue, newValue: value });
        
        // حفظ تلقائي (اختياري - يمكن تفعيله حسب الحاجة)
        // this.autoSave();
        
        return true;
    }
    
    /**
     * الحصول على قيمة حقل معين
     * @param {string} fieldPath - مسار الحقل
     * @returns {any} - القيمة
     */
    getField(fieldPath) {
        const parts = fieldPath.split('.');
        let target = this.currentCase.data;
        
        for (const part of parts) {
            if (target === undefined || target === null) {
                return undefined;
            }
            target = target[part];
        }
        
        return target;
    }
    
    // =================================================================
    // دوال مساعدة للواجهة
    // =================================================================
    
    /**
     * الحصول على قائمة بجميع الحالات (للعرض في Dashboard)
     * @param {Object} filters - فلاتر اختيارية
     * @returns {Promise<Array>}
     */
    async getAllCasesList(filters = {}) {
        try {
            return await caseStore.getAllCases(filters);
        } catch (error) {
            console.error('[AppController] خطأ في جلب قائمة الحالات:', error);
            this.eventBus.emitError(error, 'getAllCasesList');
            return [];
        }
    }
    
    /**
     * الحصول على إحصائيات سريعة للحالات
     * @returns {Promise<Object>}
     */
    async getDashboardStats() {
        try {
            const allCases = await caseStore.getAllCases();
            
            const stats = {
                total: allCases.length,
                critical: allCases.filter(c => c.priority === 'critical').length,
                stable: allCases.filter(c => c.priority === 'low' || c.priority === 'medium').length,
                strong: allCases.filter(c => c.priority === 'high').length,
                byStatus: {
                    new: allCases.filter(c => c.status === 'new').length,
                    pending: allCases.filter(c => c.status === 'pending').length,
                    active: allCases.filter(c => c.status === 'active').length,
                    closed: allCases.filter(c => c.status === 'closed').length
                },
                byPriority: {
                    low: allCases.filter(c => c.priority === 'low').length,
                    medium: allCases.filter(c => c.priority === 'medium').length,
                    high: allCases.filter(c => c.priority === 'high').length,
                    critical: allCases.filter(c => c.priority === 'critical').length
                },
                lastUpdated: new Date().toISOString()
            };
            
            return stats;
        } catch (error) {
            console.error('[AppController] خطأ في جلب الإحصائيات:', error);
            return {
                total: 0,
                critical: 0,
                stable: 0,
                strong: 0,
                byStatus: { new: 0, pending: 0, active: 0, closed: 0 },
                byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
                error: error.message
            };
        }
    }
    
    /**
     * التصدير للنسخ الاحتياطي
     * @returns {Promise<Object>}
     */
    async exportBackup() {
        try {
            return await caseStore.exportAllData();
        } catch (error) {
            console.error('[AppController] خطأ في التصدير:', error);
            throw error;
        }
    }
    
    /**
     * الاستيراد من نسخة احتياطية
     * @param {Object} backupData - بيانات النسخة الاحتياطية
     * @returns {Promise<number>}
     */
    async importBackup(backupData) {
        try {
            const count = await caseStore.importAllData(backupData);
            this.eventBus.emit('backupRestored', { count });
            return count;
        } catch (error) {
            console.error('[AppController] خطأ في الاستيراد:', error);
            throw error;
        }
    }
    
    // =================================================================
    // إدارة الأحداث (Event Management)
    // =================================================================
    
    /**
     * التسجيل لحدث معين
     * @param {string} event - اسم الحدث
     * @param {Function} callback - الدالة المستدعاة
     */
    on(event, callback) {
        this.eventBus.on(event, callback);
        this.listeners.push({ event, callback });
    }
    
    /**
     * إلغاء التسجيل من حدث
     * @param {string} event - اسم الحدث
     * @param {Function} callback - الدالة المستدعاة
     */
    off(event, callback) {
        this.eventBus.off(event, callback);
        this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === callback));
    }
    
    /**
     * تنظيف جميع المستمعين (عند إغلاق التطبيق)
     */
    cleanup() {
        this.listeners.forEach(({ event, callback }) => {
            this.eventBus.off(event, callback);
        });
        this.listeners = [];
        this.eventBus.removeAllListeners();
        console.log('[AppController] تم تنظيف جميع المستمعين');
    }
    
    /**
     * حفظ تلقائي (اختياري)
     */
    async autoSave() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        this.autoSaveTimeout = setTimeout(async () => {
            if (this.currentCase.data.caseNo && this.currentCase.data.fullName) {
                try {
                    await this.saveCase();
                    console.log('[AppController] حفظ تلقائي تم بنجاح');
                    this.eventBus.emit('autoSaveCompleted', { caseId: this.currentCase.caseId });
                } catch (error) {
                    console.error('[AppController] خطأ في الحفظ التلقائي:', error);
                }
            }
        }, 3000); // حفظ بعد 3 ثوان من آخر تغيير
    }
}

// =====================================================================
// تصدير نسخة واحدة (Singleton) للاستخدام في جميع أنحاء التطبيق
// =====================================================================
const appController = new AppController();

module.exports = appController;
module.exports.AppController = AppController; // للاختبار والاستخدام المتقدم
