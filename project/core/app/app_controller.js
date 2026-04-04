/**
 * app_controller.js - المتحكم الرئيسي للتطبيق
 * تم التحديث: إضافة دوال التحكم بالذكاء الاصطناعي والحالات الخاصة
 */

const AppController = (function() {
    'use strict';
    
    // ==================== دوال الذكاء الاصطناعي ====================
    
    /**
     * تهيئة الذكاء الاصطناعي عند تحميل التطبيق
     */
    function initAI() {
        console.log('🤖 AI Assistant Initializing...');
        
        // فحص اتصال البوتات
        checkBotConnections();
        
        // تحميل تفضيلات الذكاء الاصطناعي
        loadAIPreferences();
        
        // بدء مراقبة الحالات المستعجلة
        startUrgentCasesMonitor();
        
        // بدء مراقبة التذكيرات
        startRemindersMonitor();
        
        console.log('✅ AI Assistant Ready');
    }
    
    /**
     * فحص اتصال البوتات
     */
    async function checkBotConnections() {
        try {
            if (window.aiRouter) {
                const mainBotStatus = await window.aiRouter.checkMainBot();
                const keeperBotStatus = await window.aiRouter.checkKeeperBot();
                
                console.log(`🤖 Main Bot: ${mainBotStatus ? 'Connected' : 'Disconnected'}`);
                console.log(`🤖 Keeper Bot: ${keeperBotStatus ? 'Connected' : 'Disconnected'}`);
                
                // تحديث واجهة المستخدم
                updateAIBotStatus(mainBotStatus, keeperBotStatus);
            }
        } catch (error) {
            console.error('Error checking bot connections:', error);
        }
    }
    
    /**
     * تحميل تفضيلات الذكاء الاصطناعي
     */
    function loadAIPreferences() {
        const savedPrefs = localStorage.getItem('ai_preferences');
        if (savedPrefs) {
            window.AIPreferences = JSON.parse(savedPrefs);
        } else {
            window.AIPreferences = {
                autoSuggestions: true,
                notificationsEnabled: true,
                priorityAlerts: true,
                language: 'ar'
            };
        }
    }
    
    /**
     * تحديث حالة البوتات في الواجهة
     */
    function updateAIBotStatus(mainStatus, keeperStatus) {
        const mainBotIcon = document.getElementById('mainBotStatus');
        const keeperBotIcon = document.getElementById('keeperBotStatus');
        
        if (mainBotIcon) {
            mainBotIcon.className = mainStatus ? 'fas fa-circle text-success' : 'fas fa-circle text-danger';
            mainBotIcon.title = mainStatus ? 'البوت الرئيسي متصل' : 'البوت الرئيسي غير متصل';
        }
        
        if (keeperBotIcon) {
            keeperBotIcon.className = keeperStatus ? 'fas fa-circle text-success' : 'fas fa-circle text-danger';
            keeperBotIcon.title = keeperStatus ? 'بوت التذكير متصل' : 'بوت التذكير غير متصل';
        }
    }
    
    /**
     * بدء مراقبة الحالات المستعجلة
     */
    function startUrgentCasesMonitor() {
        // فحص كل 5 دقائق للحالات المستعجلة الجديدة
        setInterval(() => {
            checkUrgentCases();
        }, 5 * 60 * 1000);
        
        // فحص أولي
        checkUrgentCases();
    }
    
    /**
     * فحص الحالات المستعجلة
     */
    async function checkUrgentCases() {
        if (window.CaseStore) {
            const urgentCases = window.CaseStore.getSpecialCases({ priority: 'high', status: 'pending' });
            
            if (urgentCases.length > 0 && window.AIPreferences.priorityAlerts) {
                showUrgentAlert(urgentCases);
                
                // إرسال إشعار لبوت التذكير
                if (window.aiRouter) {
                    for (const urgentCase of urgentCases) {
                        await window.aiRouter.sendToKeeperBot({
                            type: 'urgent_case_alert',
                            caseId: urgentCase.id,
                            caseName: urgentCase.name,
                            priority: urgentCase.priority,
                            message: `⚠️ حالة مستعجلة: ${urgentCase.name} - الأولوية: عالية`
                        });
                    }
                }
            }
        }
    }
    
    /**
     * عرض تنبيه للحالات المستعجلة
     */
    function showUrgentAlert(urgentCases) {
        const alertHtml = `
            <div class="urgent-alert alert alert-danger alert-dismissible fade show" role="alert">
                <i class="fas fa-exclamation-triangle me-2"></i>
                <strong>تنبيه!</strong> يوجد ${urgentCases.length} حالة مستعجلة بحاجة للمراجعة.
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                <a href="/modules/cases/special_cases/index.html" class="alert-link ms-2">عرض الحالات</a>
            </div>
        `;
        
        const alertContainer = document.getElementById('alertsContainer');
        if (alertContainer) {
            alertContainer.insertAdjacentHTML('afterbegin', alertHtml);
        } else {
            // عرض كـ SweetAlert
            Swal.fire({
                title: '⚠️ حالات مستعجلة',
                text: `يوجد ${urgentCases.length} حالة مستعجلة بحاجة للمراجعة الفورية`,
                icon: 'warning',
                confirmButtonText: 'عرض الحالات',
                showCancelButton: true
            }).then((result) => {
                if (result.isConfirmed) {
                    window.location.href = '/modules/cases/special_cases/index.html';
                }
            });
        }
    }
    
    /**
     * بدء مراقبة التذكيرات
     */
    function startRemindersMonitor() {
        // فحص كل دقيقة للتذكيرات المستحقة
        setInterval(() => {
            processPendingReminders();
        }, 60 * 1000);
        
        // فحص أولي بعد 5 ثواني
        setTimeout(() => processPendingReminders(), 5000);
    }
    
    /**
     * معالجة التذكيرات المستحقة
     */
    async function processPendingReminders() {
        if (window.CaseStore) {
            const pendingReminders = window.CaseStore.getPendingReminders();
            
            for (const reminder of pendingReminders) {
                // إرسال التذكير عبر بوت التليجرام
                if (window.aiRouter) {
                    const caseData = window.CaseStore.getSpecialCaseById(reminder.caseId);
                    
                    if (caseData) {
                        const sent = await window.aiRouter.sendToTelegram({
                            type: 'reminder',
                            caseId: reminder.caseId,
                            caseName: caseData.name,
                            message: reminder.message,
                            scheduledFor: reminder.scheduledFor
                        });
                        
                        if (sent) {
                            window.CaseStore.markReminderSent(reminder.id);
                            console.log(`✅ Reminder sent for case: ${caseData.name}`);
                        } else if (reminder.retryCount >= 3) {
                            // بعد 3 محاولات فاشلة، نلغي التذكير
                            reminder.status = 'cancelled';
                            console.error(`❌ Failed to send reminder for case: ${caseData.name}`);
                        } else {
                            reminder.retryCount++;
                        }
                    }
                }
            }
        }
    }
    
    // ==================== دوال المساعد الذكي ====================
    
    /**
     * فتح نافذة المساعد الذكي
     */
    function openAIAssistant(context = null) {
        if (window.AIAssistantPopup) {
            window.aiAssistantInstance = new window.AIAssistantPopup();
            window.aiAssistantInstance.open(context);
        } else {
            console.error('AI Assistant Popup not loaded');
            // تحميل النافذة ديناميكياً
            loadAIAssistantPopup();
        }
    }
    
    /**
     * تحميل نافذة المساعد الذكي ديناميكياً
     */
    function loadAIAssistantPopup() {
        const script = document.createElement('script');
        script.src = '/ui/components/ai_assistant_popup.js';
        script.onload = () => {
            window.aiAssistantInstance = new window.AIAssistantPopup();
            window.aiAssistantInstance.open();
        };
        document.head.appendChild(script);
    }
    
    /**
     * طلب مساعدة الذكاء الاصطناعي لحالة معينة
     */
    async function askAI(caseId, question) {
        if (window.aiEngine) {
            const caseData = window.CaseStore.getSpecialCaseById(caseId);
            if (caseData) {
                const response = await window.aiEngine.analyzeCase(caseData, question);
                return response;
            }
        }
        return { error: 'AI Engine not available' };
    }
    
    // ==================== دوال الإحصائيات ====================
    
    /**
     * تحديث لوحة الإحصائيات
     */
    function updateDashboardStats() {
        if (window.CaseStore) {
            const stats = window.CaseStore.getAIStatistics();
            
            // تحديث العناصر في الواجهة
            const elements = {
                'totalSpecialCases': stats.totalSpecialCases,
                'highPriorityCases': stats.highPriorityCases,
                'pendingReminders': stats.pendingReminders,
                'completionRate': stats.completionRate
            };
            
            for (const [id, value] of Object.entries(elements)) {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = value;
                }
            }
        }
    }
    
    /**
     * تصدير التقرير (للذكاء الاصطناعي)
     */
    function exportAIReport() {
        if (window.CaseStore) {
            const stats = window.CaseStore.getAIStatistics();
            const cases = window.CaseStore.getSpecialCases();
            
            const report = {
                generatedAt: new Date().toISOString(),
                statistics: stats,
                recentCases: cases.slice(0, 10),
                systemInfo: {
                    version: '2.0.0',
                    aiEnabled: true,
                    botsConnected: true
                }
            };
            
            // تحميل الملف
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ai_report_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }
    
    // ==================== دوال التهيئة ====================
    
    /**
     * تهيئة التطبيق بالكامل
     */
    function init() {
        console.log('🚀 AppController Initializing...');
        
        // تهيئة الذكاء الاصطناعي
        initAI();
        
        // تحديث الإحصائيات كل 30 ثانية
        setInterval(() => updateDashboardStats(), 30000);
        updateDashboardStats();
        
        // إضافة مستمعي الأحداث العامة
        attachGlobalEventListeners();
        
        console.log('✅ AppController Ready');
    }
    
    /**
     * إضافة مستمعي الأحداث العامة
     */
    function attachGlobalEventListeners() {
        // زر فتح المساعد الذكي
        document.addEventListener('click', (e) => {
            if (e.target.closest('.open-ai-assistant')) {
                e.preventDefault();
                openAIAssistant();
            }
        });
        
        // مراقبة حالة الاتصال
        if (window.ConnectionMonitor) {
            window.ConnectionMonitor.init();
        }
    }
    
    // ==================== دوال مساعدة ====================
    
    /**
     * تسجيل حدث في النظام
     */
    function logEvent(eventName, eventData) {
        const log = {
            timestamp: new Date().toISOString(),
            event: eventName,
            data: eventData,
            user: getUserInfo()
        };
        
        console.log('[APP_LOG]', log);
        
        // حفظ في localStorage للسجلات
        const logs = JSON.parse(localStorage.getItem('app_logs') || '[]');
        logs.unshift(log);
        if (logs.length > 100) logs.pop();
        localStorage.setItem('app_logs', JSON.stringify(logs));
    }
    
    /**
     * الحصول على معلومات المستخدم
     */
    function getUserInfo() {
        return {
            id: localStorage.getItem('user_id') || 'anonymous',
            name: localStorage.getItem('user_name') || 'زائر',
            role: localStorage.getItem('user_role') || 'viewer'
        };
    }
    
    // ==================== التصدير ====================
    
    // التهيئة التلقائية عند تحميل الصفحة
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // الواجهة العامة
    return {
        init,
        initAI,
        openAIAssistant,
        askAI,
        exportAIReport,
        checkBotConnections,
        logEvent,
        getAIStats: () => window.CaseStore ? window.CaseStore.getAIStatistics() : null
    };
})();

// تصدير للاستخدام في المتصفح
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppController;
}
