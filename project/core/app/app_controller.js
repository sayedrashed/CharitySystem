// =====================================================================
// core/app/app_controller.js
// المتحكم الرئيسي للتطبيق - App Controller
// المرجع: PROJECT_CONTEXT.txt
// المبادئ: currentCase.data هو مصدر الحقيقة، Event Bus للإشعارات
// المهام:
// 1. إدارة currentCase (مصدر الحقيقة الوحيد)
// 2. فتح وحفظ وحذف الحالات
// 3. Event Bus للتواصل بين المكونات
// 4. ربط case_view.html و mcc.html
// 5. إدارة المستخدم الحالي والصلاحيات
// =====================================================================

const EventEmitter = require('events');
const caseStore = require('../cases/case_store');

// =====================================================================
// Event Bus - نظام الإشعارات المركزي
// =====================================================================

class AppEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
    }
    
    emitDataChange(eventType, data) {
        this.emit('dataChange', { type: eventType, data, timestamp: new Date().toISOString() });
    }
    
    emitCurrentCaseChanged(caseData) {
        this.emit('currentCaseChanged', caseData);
        this.emitDataChange('currentCaseChanged', caseData);
    }
    
    emitCaseSaved(caseId) {
        this.emit('caseSaved', caseId);
        this.emitDataChange('caseSaved', { caseId });
    }
    
    emitCaseDeleted(caseId) {
        this.emit('caseDeleted', caseId);
        this.emitDataChange('caseDeleted', { caseId });
    }
    
    emitError(error, context) {
        this.emit('error', { error, context, timestamp: new Date().toISOString() });
    }
    
    emitFieldUpdated(fieldPath, oldValue, newValue) {
        this.emit('fieldUpdated', { fieldPath, oldValue, newValue, timestamp: new Date().toISOString() });
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
                // البيانات الأساسية
                caseSerial: '',
                caseMM: '',
                caseDate: new Date().toISOString().split('T')[0],
                officeResearcher: '',
                visitTeam: '',
                status: 'new',
                priority: 'medium',
                category: '',
                branch: '',
                
                // التاريخ التطوري
                historyLog: [],
                
                // البيانات الديموغرافية
                fullName: '',
                nationalId: '',
                shortAddress: '',
                detailedAddress: '',
                gpsLink: '',
                lat: '',
                lng: '',
                phones: [],
                visaNumber: '',
                governorate: '',
                district: '',
                
                // الأسرة والأفراد
                familyMembers: [],
                individuals: {},
                
                // الدخل والمصروفات
                income: {
                    pensions: [],
                    work: [],
                    charities: [],
                    relatives: [],
                    others: []
                },
                expenses: {
                    rent: 0,
                    electricity: 0,
                    water: 0,
                    gas: 0,
                    internet: 0,
                    mobile: 0,
                    medical: 0,
                    lessons: 0,
                    installments: 0,
                    other: 0,
                    dailyFood: 0
                },
                
                // التقارير
                humanReports: {},
                aiReport: '',
                aiRecommendation: '',
                
                // توثيق المتبرع
                donorOpinion: '',
                approvalDate: '',
                donorSignatureImage: '',
                
                // المنح
                grants: {
                    ramadan: { enabled: false, amount: 200, type: 'both' },
                    eidFitr: { enabled: false, amount: 150, type: 'cash' },
                    eidAdha: { enabled: false, amount: 200, type: 'cash' },
                    study: { enabled: false, amount: 300, type: 'cash' }
                },
                exemptedGrants: [],
                
                // إعدادات النظام
                systemConfig: {
                    theme: 'dark',
                    fontSize: 'medium',
                    itemsPerPage: 10,
                    cardsConfig: null
                },
                
                createdAt: null,
                updatedAt: null
            },
            createdAt: null,
            updatedAt: null
        };
        
        this.eventBus = new AppEventBus();
        this.listeners = [];
        this.isLoading = false;
        this.autoSaveTimeout = null;
        this.currentUser = null;
        
        this.init();
    }
    
    // =================================================================
    // التهيئة
    // =================================================================
    
    async init() {
        try {
            await caseStore.ensureDirectories();
            this.loadSystemConfig();
            this.loadCurrentUser();
            console.log('[AppController] تم تهيئة المتحكم بنجاح');
        } catch (error) {
            console.error('[AppController] خطأ في التهيئة:', error);
            this.eventBus.emitError(error, 'init');
        }
    }
    
    loadSystemConfig() {
        try {
            const saved = localStorage.getItem('system_config');
            if (saved) {
                const config = JSON.parse(saved);
                this.currentCase.data.systemConfig = { ...this.currentCase.data.systemConfig, ...config };
            }
        } catch (error) {
            console.error('[AppController] خطأ في تحميل إعدادات النظام:', error);
        }
    }
    
    loadCurrentUser() {
        try {
            const saved = localStorage.getItem('currentUser');
            if (saved) {
                this.currentUser = JSON.parse(saved);
            }
        } catch (error) {
            console.error('[AppController] خطأ في تحميل المستخدم الحالي:', error);
        }
    }
    
    // =================================================================
    // إدارة الحالة الحالية (currentCase)
    // =================================================================
    
    newCase() {
        const now = new Date().toISOString();
        this.currentCase = {
            caseId: null,
            data: {
                caseSerial: '',
                caseMM: '',
                caseDate: new Date().toISOString().split('T')[0],
                officeResearcher: '',
                visitTeam: '',
                status: 'new',
                priority: 'medium',
                category: '',
                branch: '',
                historyLog: [],
                fullName: '',
                nationalId: '',
                shortAddress: '',
                detailedAddress: '',
                gpsLink: '',
                lat: '',
                lng: '',
                phones: [],
                visaNumber: '',
                governorate: '',
                district: '',
                familyMembers: [],
                individuals: {},
                income: { pensions: [], work: [], charities: [], relatives: [], others: [] },
                expenses: { rent: 0, electricity: 0, water: 0, gas: 0, internet: 0, mobile: 0, medical: 0, lessons: 0, installments: 0, other: 0, dailyFood: 0 },
                humanReports: {},
                aiReport: '',
                aiRecommendation: '',
                donorOpinion: '',
                approvalDate: '',
                donorSignatureImage: '',
                grants: {
                    ramadan: { enabled: false, amount: 200, type: 'both' },
                    eidFitr: { enabled: false, amount: 150, type: 'cash' },
                    eidAdha: { enabled: false, amount: 200, type: 'cash' },
                    study: { enabled: false, amount: 300, type: 'cash' }
                },
                exemptedGrants: [],
                systemConfig: this.currentCase.data.systemConfig,
                createdAt: now,
                updatedAt: now
            },
            createdAt: now,
            updatedAt: now
        };
        
        console.log('[AppController] تم إنشاء حالة جديدة فارغة');
        this.eventBus.emitCurrentCaseChanged(this.currentCase);
        return this.currentCase;
    }
    
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
            
            this.currentCase = {
                caseId: loadedCase.caseId,
                data: loadedCase.data || loadedCase,
                createdAt: loadedCase.createdAt,
                updatedAt: loadedCase.updatedAt
            };
            
            // التأكد من وجود البنية الأساسية
            this.ensureDataStructure();
            
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
    
    ensureDataStructure() {
        const data = this.currentCase.data;
        if (!data.income) data.income = { pensions: [], work: [], charities: [], relatives: [], others: [] };
        if (!data.expenses) data.expenses = { rent: 0, electricity: 0, water: 0, gas: 0, internet: 0, mobile: 0, medical: 0, lessons: 0, installments: 0, other: 0, dailyFood: 0 };
        if (!data.humanReports) data.humanReports = {};
        if (!data.familyMembers) data.familyMembers = [];
        if (!data.individuals) data.individuals = {};
        if (!data.phones) data.phones = [];
        if (!data.historyLog) data.historyLog = [];
        if (!data.grants) data.grants = {
            ramadan: { enabled: false, amount: 200, type: 'both' },
            eidFitr: { enabled: false, amount: 150, type: 'cash' },
            eidAdha: { enabled: false, amount: 200, type: 'cash' },
            study: { enabled: false, amount: 300, type: 'cash' }
        };
        if (!data.exemptedGrants) data.exemptedGrants = [];
    }
    
    async saveCase() {
        if (!this.currentCase.data.fullName && !this.currentCase.data.caseSerial) {
            // حالة جديدة بدون بيانات كافية، نعطيها معرف مؤقت
            const now = new Date();
            this.currentCase.data.caseSerial = `TMP-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${now.getTime().toString().slice(-6)}`;
        }
        
        const now = new Date().toISOString();
        this.currentCase.updatedAt = now;
        this.currentCase.data.updatedAt = now;
        
        if (!this.currentCase.createdAt) {
            this.currentCase.createdAt = now;
            this.currentCase.data.createdAt = now;
        }
        
        // إضافة سجل في التاريخ التطوري
        this.addToHistory('تم حفظ الحالة');
        
        try {
            const savedCase = await caseStore.saveCase(this.currentCase);
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
    
    async deleteCurrentCase(permanent = false) {
        if (!this.currentCase.caseId) {
            console.log('[AppController] لا توجد حالة حالية للحذف');
            return false;
        }
        
        const caseId = this.currentCase.caseId;
        
        try {
            const result = await caseStore.deleteCase(caseId, permanent);
            
            if (result) {
                this.addToHistory(`تم حذف الحالة (${permanent ? 'دائم' : 'soft'})`);
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
    
    updateField(fieldPath, value) {
        const parts = fieldPath.split('.');
        let target = this.currentCase.data;
        
        for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]]) {
                target[parts[i]] = {};
            }
            target = target[parts[i]];
        }
        
        const lastPart = parts[parts.length - 1];
        const oldValue = target[lastPart];
        target[lastPart] = value;
        
        this.currentCase.updatedAt = new Date().toISOString();
        this.currentCase.data.updatedAt = this.currentCase.updatedAt;
        
        console.log(`[AppController] تحديث الحقل: ${fieldPath} =`, value);
        this.eventBus.emitFieldUpdated(fieldPath, oldValue, value);
        
        // حفظ تلقائي
        this.autoSave();
        
        return true;
    }
    
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
    
    addToHistory(action, details = '') {
        const historyEntry = {
            timestamp: new Date().toISOString(),
            action: action,
            details: details,
            user: this.currentUser?.name || 'system',
            userId: this.currentUser?.id || null
        };
        
        if (!this.currentCase.data.historyLog) {
            this.currentCase.data.historyLog = [];
        }
        
        this.currentCase.data.historyLog.unshift(historyEntry);
        
        // الاحتفاظ بآخر 100 سجل فقط
        if (this.currentCase.data.historyLog.length > 100) {
            this.currentCase.data.historyLog.pop();
        }
    }
    
    // =================================================================
    // حفظ تلقائي
    // =================================================================
    
    autoSave() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        this.autoSaveTimeout = setTimeout(async () => {
            if (this.currentCase.data.fullName || this.currentCase.data.caseSerial) {
                try {
                    await this.saveCase();
                    console.log('[AppController] حفظ تلقائي تم بنجاح');
                    this.eventBus.emit('autoSaveCompleted', { caseId: this.currentCase.caseId });
                } catch (error) {
                    console.error('[AppController] خطأ في الحفظ التلقائي:', error);
                }
            }
        }, 3000);
    }
    
    // =================================================================
    // دوال مساعدة للواجهة
    // =================================================================
    
    async getAllCasesList(filters = {}) {
        try {
            return await caseStore.getAllCases(filters);
        } catch (error) {
            console.error('[AppController] خطأ في جلب قائمة الحالات:', error);
            this.eventBus.emitError(error, 'getAllCasesList');
            return [];
        }
    }
    
    async getDashboardStats() {
        try {
            const allCases = await caseStore.getAllCases();
            
            return {
                total: allCases.length,
                new: allCases.filter(c => c.status === 'new').length,
                pending: allCases.filter(c => c.status === 'pending').length,
                active: allCases.filter(c => c.status === 'active').length,
                closed: allCases.filter(c => c.status === 'closed').length,
                cancelled: allCases.filter(c => c.status === 'cancelled').length,
                byPriority: {
                    low: allCases.filter(c => c.priority === 'low').length,
                    medium: allCases.filter(c => c.priority === 'medium').length,
                    high: allCases.filter(c => c.priority === 'high').length,
                    critical: allCases.filter(c => c.priority === 'critical').length
                },
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            console.error('[AppController] خطأ في جلب الإحصائيات:', error);
            return {
                total: 0,
                new: 0,
                pending: 0,
                active: 0,
                closed: 0,
                cancelled: 0,
                byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
                error: error.message
            };
        }
    }
    
    async searchCases(query, filters = {}) {
        try {
            return await caseStore.searchCases(query, filters);
        } catch (error) {
            console.error('[AppController] خطأ في البحث:', error);
            return [];
        }
    }
    
    async exportBackup() {
        try {
            return await caseStore.exportAllData();
        } catch (error) {
            console.error('[AppController] خطأ في التصدير:', error);
            throw error;
        }
    }
    
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
    
    on(event, callback) {
        this.eventBus.on(event, callback);
        this.listeners.push({ event, callback });
    }
    
    off(event, callback) {
        this.eventBus.off(event, callback);
        this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === callback));
    }
    
    cleanup() {
        this.listeners.forEach(({ event, callback }) => {
            this.eventBus.off(event, callback);
        });
        this.listeners = [];
        this.eventBus.removeAllListeners();
        console.log('[AppController] تم تنظيف جميع المستمعين');
    }
    
    // =================================================================
    // إدارة المستخدم
    // =================================================================
    
    setCurrentUser(user) {
        this.currentUser = user;
        localStorage.setItem('currentUser', JSON.stringify(user));
        this.eventBus.emit('userChanged', user);
    }
    
    getCurrentUser() {
        return this.currentUser;
    }
    
    logout() {
        this.currentUser = null;
        localStorage.removeItem('currentUser');
        this.eventBus.emit('userLoggedOut');
    }
    
    // =================================================================
    // إدارة الأرقام التسلسلية
    // =================================================================
    
    async getNextSerialNumbers(category) {
        try {
            const globalSerial = await caseStore.getNextGlobalSerial();
            const accountingSerial = await caseStore.getNextAccountingSerial(category);
            return { global: globalSerial, accounting: accountingSerial };
        } catch (error) {
            console.error('[AppController] خطأ في جلب الأرقام التسلسلية:', error);
            return { global: null, accounting: null };
        }
    }
    
    async releaseSerialNumbers(caseSerial, category, accountingSerial) {
        try {
            if (caseSerial) {
                await caseStore.releaseGlobalSerial(parseInt(caseSerial));
            }
            if (category && accountingSerial) {
                await caseStore.releaseAccountingSerial(category, parseInt(accountingSerial));
            }
            return true;
        } catch (error) {
            console.error('[AppController] خطأ في تحرير الأرقام التسلسلية:', error);
            return false;
        }
    }
}

// =====================================================================
// إنشاء نسخة واحدة (Singleton)
// =====================================================================

const appController = new AppController();

module.exports = appController;
module.exports.AppController = AppController;
