// =====================================================================
// core/bot_manager.js
// مدير البوتات - إدارة وتنسيق بوتات التليجرام
// المرجع: PROJECT_CONTEXT.txt
// المبادئ: البوتات لا يتم تعديلها، هذا الملف يديرها ويتواصل معها
// =====================================================================

class BotManager {
    constructor() {
        // تكوين البوتات
        this.bots = {
            main: {
                name: 'المساعد الذكي',
                token: '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk',
                chatId: -1001639560426,
                script: 'core/ai/telegram_ai_bot.py',
                status: 'stopped',
                pid: null,
                enabled: true
            },
            keeper: {
                name: 'بوت التذكير',
                token: '7443426622:AAFbPKjJ0fSweZxHxpglopgdg6hyWkLJgs8',
                adminId: 2130979393,
                script: 'core/ai/keeper_bot.py',
                status: 'stopped',
                pid: null,
                enabled: true
            },
            workGroup: {
                name: 'بوت جروب العمل',
                token: '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk',
                chatId: -1001639560426,
                script: 'core/ai/work_group_bot.py',
                status: 'stopped',
                pid: null,
                enabled: false  // سيتم تفعيله بعد إنشاء الجروب
            },
            locations: {
                name: 'بوت جروب مواقع الحالات',
                token: '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk',
                script: 'core/ai/locations_group_bot.py',
                status: 'stopped',
                pid: null,
                enabled: false  // سيتم تفعيله بعد إنشاء الجروب
            }
        };
        
        // سجل الأحداث
        this.eventLog = [];
        
        // مستمعي الأحداث
        this.listeners = {
            'botStarted': [],
            'botStopped': [],
            'botError': [],
            'messageReceived': [],
            'messageSent': []
        };
        
        // فترة فحص الصحة (بالمللي ثانية)
        this.healthCheckInterval = 30000; // 30 ثانية
        
        // مؤقت فحص الصحة
        this.healthChecker = null;
        
        // تهيئة
        this.init();
    }
    
    // ============================================================
    // التهيئة
    // ============================================================
    
    init() {
        console.log('[BotManager] تهيئة مدير البوتات...');
        
        // تحميل الإعدادات المحفوظة
        this.loadSettings();
        
        // بدء فحص صحة البوتات
        this.startHealthCheck();
        
        console.log('[BotManager] تم تهيئة مدير البوتات بنجاح');
    }
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('bot_manager_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                for (const botId in this.bots) {
                    if (settings[botId]) {
                        this.bots[botId].enabled = settings[botId].enabled !== undefined ? settings[botId].enabled : this.bots[botId].enabled;
                    }
                }
                console.log('[BotManager] تم تحميل الإعدادات المحفوظة');
            }
        } catch (error) {
            console.error('[BotManager] خطأ في تحميل الإعدادات:', error);
        }
    }
    
    saveSettings() {
        try {
            const settings = {};
            for (const botId in this.bots) {
                settings[botId] = {
                    enabled: this.bots[botId].enabled
                };
            }
            localStorage.setItem('bot_manager_settings', JSON.stringify(settings));
        } catch (error) {
            console.error('[BotManager] خطأ في حفظ الإعدادات:', error);
        }
    }
    
    // ============================================================
    // إدارة البوتات
    // ============================================================
    
    /**
     * تشغيل بوت
     * @param {string} botId - معرف البوت (main, keeper, workGroup, locations)
     * @returns {Promise<boolean>}
     */
    async startBot(botId) {
        const bot = this.bots[botId];
        if (!bot) {
            this.emit('botError', { botId, error: 'بوت غير موجود' });
            return false;
        }
        
        if (bot.status === 'running') {
            console.log(`[BotManager] البوت ${bot.name} يعمل بالفعل`);
            return true;
        }
        
        // التحقق من وجود ملف البوت
        const scriptPath = path.join(process.cwd(), bot.script);
        if (!fs.existsSync(scriptPath)) {
            this.emit('botError', { botId, error: `ملف البوت غير موجود: ${bot.script}` });
            return false;
        }
        
        try {
            // تشغيل البوت كعملية منفصلة
            const { spawn } = require('child_process');
            const pythonProcess = spawn('python', [scriptPath], {
                detached: true,
                stdio: 'ignore'
            });
            
            pythonProcess.unref();
            bot.pid = pythonProcess.pid;
            bot.status = 'running';
            bot.lastStarted = new Date().toISOString();
            
            this.logEvent(botId, 'started', { pid: bot.pid });
            this.emit('botStarted', { botId, name: bot.name, pid: bot.pid });
            
            console.log(`[BotManager] تم تشغيل البوت ${bot.name} (PID: ${bot.pid})`);
            return true;
            
        } catch (error) {
            console.error(`[BotManager] خطأ في تشغيل البوت ${bot.name}:`, error);
            this.emit('botError', { botId, error: error.message });
            return false;
        }
    }
    
    /**
     * إيقاف بوت
     * @param {string} botId - معرف البوت
     * @returns {Promise<boolean>}
     */
    async stopBot(botId) {
        const bot = this.bots[botId];
        if (!bot) return false;
        
        if (bot.status !== 'running') {
            console.log(`[BotManager] البوت ${bot.name} غير قيد التشغيل`);
            return true;
        }
        
        try {
            if (bot.pid) {
                process.kill(bot.pid);
            }
            bot.status = 'stopped';
            bot.pid = null;
            bot.lastStopped = new Date().toISOString();
            
            this.logEvent(botId, 'stopped', {});
            this.emit('botStopped', { botId, name: bot.name });
            
            console.log(`[BotManager] تم إيقاف البوت ${bot.name}`);
            return true;
            
        } catch (error) {
            console.error(`[BotManager] خطأ في إيقاف البوت ${bot.name}:`, error);
            // حتى لو فشل القتل، نعتبره متوقف
            bot.status = 'stopped';
            bot.pid = null;
            return true;
        }
    }
    
    /**
     * إعادة تشغيل بوت
     * @param {string} botId - معرف البوت
     * @returns {Promise<boolean>}
     */
    async restartBot(botId) {
        await this.stopBot(botId);
        await this.sleep(2000);
        return await this.startBot(botId);
    }
    
    /**
     * تشغيل جميع البوتات المفعّلة
     * @returns {Promise<Object>}
     */
    async startAllBots() {
        const results = {};
        for (const botId in this.bots) {
            if (this.bots[botId].enabled) {
                results[botId] = await this.startBot(botId);
            }
        }
        return results;
    }
    
    /**
     * إيقاف جميع البوتات
     * @returns {Promise<Object>}
     */
    async stopAllBots() {
        const results = {};
        for (const botId in this.bots) {
            results[botId] = await this.stopBot(botId);
        }
        return results;
    }
    
    // ============================================================
    // فحص صحة البوتات
    // ============================================================
    
    startHealthCheck() {
        if (this.healthChecker) {
            clearInterval(this.healthChecker);
        }
        
        this.healthChecker = setInterval(async () => {
            await this.checkAllBotsHealth();
        }, this.healthCheckInterval);
        
        console.log('[BotManager] تم بدء فحص صحة البوتات');
    }
    
    async checkAllBotsHealth() {
        for (const botId in this.bots) {
            await this.checkBotHealth(botId);
        }
    }
    
    async checkBotHealth(botId) {
        const bot = this.bots[botId];
        if (!bot.enabled) return;
        
        // محاولة الاتصال بالبوت عبر API
        try {
            const response = await fetch(`http://localhost:3000/api/bot/${botId}/status`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!response.ok) {
                // البوت لا يستجيب، محاولة إعادة التشغيل
                console.warn(`[BotManager] البوت ${bot.name} لا يستجيب، جاري إعادة التشغيل...`);
                await this.restartBot(botId);
            } else {
                const data = await response.json();
                if (data.status === 'running' && bot.status !== 'running') {
                    bot.status = 'running';
                }
            }
        } catch (error) {
            // فشل الاتصال، محاولة إعادة التشغيل
            if (bot.status === 'running') {
                console.warn(`[BotManager] فقد الاتصال بالبوت ${bot.name}، جاري إعادة التشغيل...`);
                await this.restartBot(botId);
            }
        }
    }
    
    // ============================================================
    // إرسال رسائل عبر البوتات
    // ============================================================
    
    /**
     * إرسال رسالة عبر البوت الرئيسي
     * @param {string} message - نص الرسالة
     * @param {number} chatId - معرف الدردشة (اختياري)
     * @returns {Promise<boolean>}
     */
    async sendMessage(message, chatId = null) {
        const bot = this.bots.main;
        if (!bot.enabled || bot.status !== 'running') {
            console.warn('[BotManager] البوت الرئيسي غير متاح');
            return false;
        }
        
        try {
            const response = await fetch('http://localhost:3000/api/bot/main/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, chatId: chatId || bot.chatId })
            });
            
            if (response.ok) {
                this.emit('messageSent', { botId: 'main', message });
                return true;
            }
        } catch (error) {
            console.error('[BotManager] خطأ في إرسال الرسالة:', error);
        }
        return false;
    }
    
    /**
     * إرسال إشعار للمدير
     * @param {string} message - نص الإشعار
     * @param {string} type - نوع الإشعار (info, warning, error, success)
     * @returns {Promise<boolean>}
     */
    async notifyAdmin(message, type = 'info') {
        const bot = this.bots.keeper;
        if (!bot.enabled || bot.status !== 'running') {
            console.warn('[BotManager] بوت التذكير غير متاح');
            return false;
        }
        
        const emoji = {
            info: 'ℹ️',
            warning: '⚠️',
            error: '❌',
            success: '✅'
        };
        
        const fullMessage = `${emoji[type] || '📢'} ${message}`;
        
        try {
            const response = await fetch('http://localhost:3000/api/bot/keeper/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: fullMessage, adminId: bot.adminId })
            });
            
            if (response.ok) {
                this.emit('messageSent', { botId: 'keeper', message: fullMessage });
                return true;
            }
        } catch (error) {
            console.error('[BotManager] خطأ في إرسال إشعار للمدير:', error);
        }
        return false;
    }
    
    /**
     * طلب جلب صورة باحث من تليجرام
     * @param {string} researcherId - معرف الباحث
     * @param {number} telegramUserId - معرف المستخدم في تليجرام
     * @returns {Promise<string|null>}
     */
    async fetchResearcherAvatar(researcherId, telegramUserId) {
        const bot = this.bots.workGroup;
        if (!bot.enabled || bot.status !== 'running') {
            console.warn('[BotManager] بوت جروب العمل غير متاح');
            return null;
        }
        
        try {
            const response = await fetch('http://localhost:3000/api/bot/workgroup/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ researcherId, telegramUserId })
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.avatar;
            }
        } catch (error) {
            console.error('[BotManager] خطأ في جلب صورة الباحث:', error);
        }
        return null;
    }
    
    /**
     * طلب مزامنة جميع صور الباحثين
     * @returns {Promise<Object>}
     */
    async syncAllResearcherAvatars() {
        const bot = this.bots.workGroup;
        if (!bot.enabled || bot.status !== 'running') {
            console.warn('[BotManager] بوت جروب العمل غير متاح');
            return { success: false, message: 'البوت غير متاح' };
        }
        
        try {
            const response = await fetch('http://localhost:3000/api/bot/workgroup/sync-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                return data;
            }
        } catch (error) {
            console.error('[BotManager] خطأ في مزامنة صور الباحثين:', error);
        }
        return { success: false, message: 'فشل الاتصال بالبوت' };
    }
    
    // ============================================================
    // تسجيل الأحداث
    // ============================================================
    
    logEvent(botId, event, data = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            botId,
            event,
            data
        };
        
        this.eventLog.unshift(logEntry);
        
        // الاحتفاظ بآخر 1000 حدث فقط
        if (this.eventLog.length > 1000) {
            this.eventLog.pop();
        }
        
        // حفظ في localStorage
        try {
            localStorage.setItem('bot_manager_log', JSON.stringify(this.eventLog.slice(0, 100)));
        } catch (error) {
            // تجاهل أخطاء التخزين
        }
    }
    
    getEventLog(limit = 50) {
        return this.eventLog.slice(0, limit);
    }
    
    clearEventLog() {
        this.eventLog = [];
        localStorage.removeItem('bot_manager_log');
    }
    
    // ============================================================
    // إدارة الأحداث (Event Management)
    // ============================================================
    
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }
    
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
    
    // ============================================================
    // الحصول على حالة البوتات
    // ============================================================
    
    getBotsStatus() {
        const status = {};
        for (const botId in this.bots) {
            const bot = this.bots[botId];
            status[botId] = {
                name: bot.name,
                status: bot.status,
                enabled: bot.enabled,
                lastStarted: bot.lastStarted || null,
                lastStopped: bot.lastStopped || null,
                pid: bot.pid
            };
        }
        return status;
    }
    
    getBotStatus(botId) {
        const bot = this.bots[botId];
        if (!bot) return null;
        return {
            name: bot.name,
            status: bot.status,
            enabled: bot.enabled,
            lastStarted: bot.lastStarted || null,
            lastStopped: bot.lastStopped || null,
            pid: bot.pid
        };
    }
    
    enableBot(botId, enabled) {
        const bot = this.bots[botId];
        if (!bot) return false;
        
        bot.enabled = enabled;
        this.saveSettings();
        
        if (enabled && bot.status !== 'running') {
            this.startBot(botId);
        } else if (!enabled && bot.status === 'running') {
            this.stopBot(botId);
        }
        
        return true;
    }
    
    // ============================================================
    // دوال مساعدة
    // ============================================================
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ============================================================
    // التصدير (للاستخدام من الواجهة)
    // ============================================================
    
    getAPI() {
        return {
            startBot: (botId) => this.startBot(botId),
            stopBot: (botId) => this.stopBot(botId),
            restartBot: (botId) => this.restartBot(botId),
            startAllBots: () => this.startAllBots(),
            stopAllBots: () => this.stopAllBots(),
            getBotsStatus: () => this.getBotsStatus(),
            enableBot: (botId, enabled) => this.enableBot(botId, enabled),
            sendMessage: (message, chatId) => this.sendMessage(message, chatId),
            notifyAdmin: (message, type) => this.notifyAdmin(message, type),
            fetchResearcherAvatar: (researcherId, telegramUserId) => this.fetchResearcherAvatar(researcherId, telegramUserId),
            syncAllResearcherAvatars: () => this.syncAllResearcherAvatars(),
            getEventLog: (limit) => this.getEventLog(limit),
            clearEventLog: () => this.clearEventLog()
        };
    }
}

// ============================================================
// إنشاء نسخة واحدة من مدير البوتات
// ============================================================
const botManager = new BotManager();

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = botManager;
    module.exports.BotManager = BotManager;
} else {
    window.botManager = botManager;
    window.BotManager = BotManager;
}
