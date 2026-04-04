/**
 * case_store.js - إدارة وتخزين بيانات الحالات
 * تم التحديث: إضافة دعم للحالات الخاصة والتكامل مع الذكاء الاصطناعي
 */

const CaseStore = (function() {
    'use strict';
    
    // ==================== جداول البيانات الجديدة ====================
    
    // جدول الحالات الخاصة
    let specialCasesDB = [];
    
    // جدول تتبع التذكيرات (للتكامل مع بوت التليجرام)
    let remindersDB = [];
    
    // جدول سجل تفاعلات الذكاء الاصطناعي
    let aiInteractionsDB = [];
    
    // ==================== دوال الحالات الخاصة ====================
    
    /**
     * الحصول على جميع الحالات الخاصة
     */
    function getSpecialCases(filters = {}) {
        let result = [...specialCasesDB];
        
        if (filters.status) {
            result = result.filter(c => c.status === filters.status);
        }
        if (filters.priority) {
            result = result.filter(c => c.priority === filters.priority);
        }
        if (filters.type) {
            result = result.filter(c => c.type === filters.type);
        }
        if (filters.assignedTo) {
            result = result.filter(c => c.assignedTo === filters.assignedTo);
        }
        
        return result.sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    }
    
    /**
     * الحصول على حالة خاصة بواسطة ID
     */
    function getSpecialCaseById(id) {
        return specialCasesDB.find(c => c.id === id);
    }
    
    /**
     * إضافة حالة خاصة جديدة
     */
    function addSpecialCase(caseData) {
        const newCase = {
            id: Date.now(),
            ...caseData,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: caseData.status || 'pending',
            aiSuggestions: [],
            visitHistory: []
        };
        
        specialCasesDB.push(newCase);
        saveToLocalStorage();
        
        // تسجيل التفاعل مع الذكاء الاصطناعي
        logAICaseCreation(newCase);
        
        // إرسال إشعار للبوت (إذا كان هناك حالة عالية الأولوية)
        if (newCase.priority === 'high') {
            notifyKeeperBot(newCase);
        }
        
        return newCase;
    }
    
    /**
     * تحديث حالة خاصة
     */
    function updateSpecialCase(id, updates) {
        const index = specialCasesDB.findIndex(c => c.id === id);
        if (index === -1) return null;
        
        const oldCase = specialCasesDB[index];
        specialCasesDB[index] = {
            ...oldCase,
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        saveToLocalStorage();
        
        // تسجيل التحديث للذكاء الاصطناعي
        logAIUpdate(oldCase, specialCasesDB[index]);
        
        return specialCasesDB[index];
    }
    
    /**
     * حذف حالة خاصة
     */
    function deleteSpecialCase(id) {
        const index = specialCasesDB.findIndex(c => c.id === id);
        if (index === -1) return false;
        
        specialCasesDB.splice(index, 1);
        saveToLocalStorage();
        return true;
    }
    
    // ==================== دوال التذكيرات (للبوت) ====================
    
    /**
     * إضافة تذكير لحالة
     */
    function addReminder(caseId, reminderData) {
        const reminder = {
            id: Date.now(),
            caseId: caseId,
            type: reminderData.type || 'follow_up', // follow_up, urgent, scheduled
            scheduledFor: reminderData.scheduledFor,
            message: reminderData.message,
            status: 'pending', // pending, sent, cancelled
            createdAt: new Date().toISOString(),
            sentAt: null,
            retryCount: 0
        };
        
        remindersDB.push(reminder);
        saveToLocalStorage();
        return reminder;
    }
    
    /**
     * الحصول على التذكيرات المستحقة
     */
    function getPendingReminders() {
        const now = new Date();
        return remindersDB.filter(r => {
            if (r.status !== 'pending') return false;
            if (!r.scheduledFor) return false;
            return new Date(r.scheduledFor) <= now;
        });
    }
    
    /**
     * تحديث حالة تذكير (تم إرساله)
     */
    function markReminderSent(id) {
        const reminder = remindersDB.find(r => r.id === id);
        if (reminder) {
            reminder.status = 'sent';
            reminder.sentAt = new Date().toISOString();
            saveToLocalStorage();
        }
    }
    
    // ==================== دوال الذكاء الاصطناعي ====================
    
    /**
     * تسجيل إنشاء حالة جديدة بواسطة AI
     */
    function logAICaseCreation(caseData) {
        const interaction = {
            id: Date.now(),
            type: 'case_creation',
            caseId: caseData.id,
            caseData: caseData,
            timestamp: new Date().toISOString(),
            source: 'user'
        };
        aiInteractionsDB.push(interaction);
        saveToLocalStorage();
    }
    
    /**
     * تسجيل تحديث بواسطة AI
     */
    function logAIUpdate(oldData, newData) {
        const interaction = {
            id: Date.now(),
            type: 'case_update',
            caseId: newData.id,
            changes: {
                before: oldData,
                after: newData
            },
            timestamp: new Date().toISOString(),
            source: 'ai_assistant'
        };
        aiInteractionsDB.push(interaction);
        saveToLocalStorage();
    }
    
    /**
     * الحصول على إحصائيات للذكاء الاصطناعي
     */
    function getAIStatistics() {
        const totalCases = specialCasesDB.length;
        const highPriorityCases = specialCasesDB.filter(c => c.priority === 'high').length;
        const pendingReminders = remindersDB.filter(r => r.status === 'pending').length;
        const recentInteractions = aiInteractionsDB.filter(i => {
            return new Date(i.timestamp) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        }).length;
        
        return {
            totalSpecialCases: totalCases,
            highPriorityCases: highPriorityCases,
            pendingReminders: pendingReminders,
            weeklyAIActions: recentInteractions,
            completionRate: totalCases ? 
                (specialCasesDB.filter(c => c.status === 'completed').length / totalCases * 100).toFixed(1) : 0
        };
    }
    
    /**
     * إشعار بوت Keeper (للتذكير)
     */
    function notifyKeeperBot(caseData) {
        // هذا سيتصل بـ API البوت
        if (window.aiRouter && window.aiRouter.sendToKeeperBot) {
            window.aiRouter.sendToKeeperBot({
                type: 'urgent_case',
                caseId: caseData.id,
                caseName: caseData.name,
                priority: caseData.priority
            });
        }
    }
    
    // ==================== دوال التخزين المحلي ====================
    
    /**
     * حفظ البيانات في LocalStorage
     */
    function saveToLocalStorage() {
        try {
            localStorage.setItem('specialCasesDB', JSON.stringify(specialCasesDB));
            localStorage.setItem('remindersDB', JSON.stringify(remindersDB));
            localStorage.setItem('aiInteractionsDB', JSON.stringify(aiInteractionsDB));
        } catch(e) {
            console.error('Error saving to localStorage:', e);
        }
    }
    
    /**
     * تحميل البيانات من LocalStorage
     */
    function loadFromLocalStorage() {
        try {
            const savedSpecial = localStorage.getItem('specialCasesDB');
            const savedReminders = localStorage.getItem('remindersDB');
            const savedAI = localStorage.getItem('aiInteractionsDB');
            
            if (savedSpecial) specialCasesDB = JSON.parse(savedSpecial);
            if (savedReminders) remindersDB = JSON.parse(savedReminders);
            if (savedAI) aiInteractionsDB = JSON.parse(savedAI);
        } catch(e) {
            console.error('Error loading from localStorage:', e);
            // بيانات افتراضية للاختبار
            if (specialCasesDB.length === 0) {
                loadMockData();
            }
        }
    }
    
    /**
     * بيانات افتراضية للاختبار
     */
    function loadMockData() {
        specialCasesDB = [
            {
                id: 1001,
                name: 'أسرة محمد أحمد',
                phone: '01001234567',
                type: 'urgent',
                priority: 'high',
                status: 'pending',
                description: 'أسرة مكونة من 5 أفراد بحاجة ماسة للسكن',
                requestedAmount: 5000,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 1002,
                name: 'حالة طبية - سيدة مسنة',
                phone: '01007654321',
                type: 'medical',
                priority: 'high',
                status: 'in_progress',
                description: 'حاجة لعملية عيون عاجلة',
                requestedAmount: 15000,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];
        saveToLocalStorage();
    }
    
    // ==================== دوال التوافق مع النظام القديم ====================
    
    /**
     * دالة البحث الموحدة (للتكامل مع البحث القديم)
     */
    function searchCases(query, type = 'all') {
        query = query.toLowerCase();
        
        let results = [];
        
        if (type === 'all' || type === 'special') {
            results.push(...specialCasesDB.filter(c => 
                c.name.toLowerCase().includes(query) || 
                (c.phone && c.phone.includes(query))
            ));
        }
        
        return results;
    }
    
    // ==================== التهيئة ====================
    
    // تحميل البيانات عند بدء التشغيل
    loadFromLocalStorage();
    
    // ==================== الواجهة العامة (API) ====================
    
    return {
        // دوال الحالات الخاصة
        getSpecialCases,
        getSpecialCaseById,
        addSpecialCase,
        updateSpecialCase,
        deleteSpecialCase,
        
        // دوال التذكيرات
        addReminder,
        getPendingReminders,
        markReminderSent,
        
        // دوال الذكاء الاصطناعي
        getAIStatistics,
        
        // دوال البحث
        searchCases,
        
        // دوال مساعدة
        getStore: () => ({ specialCases: specialCasesDB, reminders: remindersDB })
    };
})();

// تصدير للاستخدام في المتصفح
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CaseStore;
}
