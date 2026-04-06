// =====================================================================
// core/sync_manager.js
// مدير المزامنة - مزامنة البيانات بين الأجهزة وجهاز المدير
// المرجع: PROJECT_CONTEXT.txt
// المبادئ: Offline-first، المزامنة عبر LAN، TeraBox للنسخ الاحتياطي
// =====================================================================

class SyncManager {
    constructor() {
        // تكوين المزامنة
        this.config = {
            managerUrl: null,           // عنوان جهاز المدير (مثل http://192.168.1.101:3000)
            deviceId: null,             // معرف هذا الجهاز
            deviceRole: 'user',         // manager / user
            syncInterval: 60000,        // 60 ثانية بين محاولات المزامنة
            retryInterval: 300000,      // 5 دقائق عند فشل الاتصال
            maxRetries: 3,              // أقصى عدد محاولات
            pendingChanges: [],         // التغييرات المعلقة
            lastSyncAt: null,           // آخر توقيت مزامنة ناجحة
            syncStatus: 'idle'          // idle, syncing, error, offline
        };
        
        // مؤقت المزامنة
        this.syncTimer = null;
        
        // مستمعي الأحداث
        this.listeners = {
            'syncStart': [],
            'syncComplete': [],
            'syncError': [],
            'syncStatusChange': [],
            'conflictDetected': []
        };
        
        // تهيئة
        this.init();
    }
    
    // ============================================================
    // التهيئة
    // ============================================================
    
    async init() {
        console.log('[SyncManager] تهيئة مدير المزامنة...');
        
        // تحميل الإعدادات المحفوظة
        await this.loadConfig();
        
        // تحديد دور الجهاز
        await this.detectDeviceRole();
        
        // بدء المزامنة الدورية
        this.startPeriodicSync();
        
        console.log('[SyncManager] تم تهيئة مدير المزامنة بنجاح');
        console.log(`[SyncManager] دور الجهاز: ${this.config.deviceRole}`);
        if (this.config.managerUrl) {
            console.log(`[SyncManager] جهاز المدير: ${this.config.managerUrl}`);
        }
    }
    
    async loadConfig() {
        try {
            // محاولة قراءة من localStorage
            const saved = localStorage.getItem('sync_manager_config');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.config = { ...this.config, ...parsed };
            }
            
            // محاولة قراءة من device.json (في بيئة سطح المكتب)
            if (typeof window !== 'undefined' && window.electronAPI) {
                const deviceConfig = await window.electronAPI.loadConfig();
                if (deviceConfig) {
                    this.config.managerUrl = deviceConfig.sync_server?.host 
                        ? `http://${deviceConfig.sync_server.host}:${deviceConfig.sync_server.port}`
                        : this.config.managerUrl;
                    this.config.deviceId = deviceConfig.device_id || this.config.deviceId;
                    this.config.deviceRole = deviceConfig.device_role || this.config.deviceRole;
                }
            }
        } catch (error) {
            console.error('[SyncManager] خطأ في تحميل الإعدادات:', error);
        }
    }
    
    async saveConfig() {
        try {
            localStorage.setItem('sync_manager_config', JSON.stringify({
                managerUrl: this.config.managerUrl,
                deviceId: this.config.deviceId,
                deviceRole: this.config.deviceRole,
                lastSyncAt: this.config.lastSyncAt
            }));
        } catch (error) {
            console.error('[SyncManager] خطأ في حفظ الإعدادات:', error);
        }
    }
    
    async detectDeviceRole() {
        // محاولة اكتشاف دور الجهاز من الإعدادات
        if (this.config.deviceRole === 'manager') {
            // هذا الجهاز هو المدير
            console.log('[SyncManager] هذا الجهاز هو المدير (Master)');
            this.config.managerUrl = null; // المدير لا يحتاج عنوان
        } else {
            // جهاز باحث - يحتاج عنوان المدير
            if (!this.config.managerUrl) {
                // محاولة اكتشاف المدير تلقائياً على الشبكة
                await this.discoverManager();
            }
        }
    }
    
    async discoverManager() {
        // محاولة اكتشاف جهاز المدير على الشبكة المحلية
        const possiblePorts = [3000, 8080, 5000];
        const possibleIps = [
            '192.168.1.101', '192.168.1.102', '192.168.1.100',
            '10.0.0.1', '10.0.0.100', '172.16.0.1'
        ];
        
        for (const ip of possibleIps) {
            for (const port of possiblePorts) {
                try {
                    const url = `http://${ip}:${port}`;
                    const response = await fetch(`${url}/api/ping`, { timeout: 2000 });
                    if (response.ok) {
                        this.config.managerUrl = url;
                        await this.saveConfig();
                        console.log(`[SyncManager] تم اكتشاف المدير: ${url}`);
                        this.emit('syncStatusChange', { status: 'manager_found', url });
                        return true;
                    }
                } catch (error) {
                    // تجاهل
                }
            }
        }
        
        console.warn('[SyncManager] لم يتم اكتشاف جهاز المدير');
        this.emit('syncStatusChange', { status: 'manager_not_found' });
        return false;
    }
    
    // ============================================================
    // المزامنة الدورية
    // ============================================================
    
    startPeriodicSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }
        
        this.syncTimer = setInterval(async () => {
            await this.sync();
        }, this.config.syncInterval);
        
        console.log(`[SyncManager] بدأ المزامنة الدورية (كل ${this.config.syncInterval / 1000} ثانية)`);
        
        // محاولة مزامنة أولية بعد 5 ثوانٍ
        setTimeout(() => this.sync(), 5000);
    }
    
    // ============================================================
    // عملية المزامنة الرئيسية
    // ============================================================
    
    async sync() {
        // التحقق من أنه ليس جهاز مدير
        if (this.config.deviceRole === 'manager') {
            // المدير لا يحتاج مزامنة مع نفسه، فقط يستقبل طلبات
            return;
        }
        
        // التحقق من وجود عنوان المدير
        if (!this.config.managerUrl) {
            this.config.syncStatus = 'offline';
            this.emit('syncStatusChange', { status: 'offline', reason: 'no_manager_url' });
            return;
        }
        
        // منع التزامن المتكرر
        if (this.config.syncStatus === 'syncing') {
            console.log('[SyncManager] مزامنة قيد التنفيذ بالفعل');
            return;
        }
        
        this.config.syncStatus = 'syncing';
        this.emit('syncStart', { timestamp: new Date().toISOString() });
        
        let retries = 0;
        let success = false;
        
        while (retries < this.config.maxRetries && !success) {
            try {
                // 1. فحص الاتصال بالمدير
                const pingResult = await this.pingManager();
                if (!pingResult) {
                    throw new Error('لا يمكن الاتصال بجهاز المدير');
                }
                
                // 2. مزامنة الوقت
                await this.syncTime();
                
                // 3. رفع التغييرات المحلية (PUSH)
                await this.pushChanges();
                
                // 4. سحب التغييرات من المدير (PULL)
                await this.pullChanges();
                
                // 5. تحديث آخر توقيت مزامنة
                this.config.lastSyncAt = new Date().toISOString();
                this.config.syncStatus = 'idle';
                this.config.syncError = null;
                await this.saveConfig();
                
                success = true;
                this.emit('syncComplete', { 
                    timestamp: this.config.lastSyncAt,
                    pendingCount: this.config.pendingChanges.length
                });
                
                console.log('[SyncManager] تمت المزامنة بنجاح');
                
            } catch (error) {
                retries++;
                console.error(`[SyncManager] فشل المزامنة (محاولة ${retries}/${this.config.maxRetries}):`, error.message);
                
                if (retries >= this.config.maxRetries) {
                    this.config.syncStatus = 'error';
                    this.config.syncError = error.message;
                    this.emit('syncError', { error: error.message, retries });
                } else {
                    // انتظار قبل إعادة المحاولة
                    await this.sleep(this.config.retryInterval / this.config.maxRetries);
                }
            }
        }
        
        if (!success) {
            this.config.syncStatus = 'error';
            this.emit('syncStatusChange', { status: 'error', reason: this.config.syncError });
        }
    }
    
    async pingManager() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.config.managerUrl}/api/ping`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            return false;
        }
    }
    
    async syncTime() {
        try {
            const response = await fetch(`${this.config.managerUrl}/api/time`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const serverTime = new Date(data.serverTime).getTime();
                const localTime = Date.now();
                const offset = serverTime - localTime;
                
                // حفظ الفارق الزمني
                localStorage.setItem('time_offset', offset);
                console.log(`[SyncManager] تم مزامنة الوقت، الفارق: ${offset}ms`);
                return offset;
            }
        } catch (error) {
            console.error('[SyncManager] فشل مزامنة الوقت:', error);
        }
        return 0;
    }
    
    async pushChanges() {
        // جمع التغييرات المحلية غير المتزامنة
        const pendingChanges = await this.getPendingChanges();
        
        if (pendingChanges.length === 0) {
            console.log('[SyncManager] لا توجد تغييرات معلقة');
            return;
        }
        
        console.log(`[SyncManager] رفع ${pendingChanges.length} تغيير معلق`);
        
        try {
            const response = await fetch(`${this.config.managerUrl}/api/sync/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.config.deviceId,
                    changes: pendingChanges,
                    timestamp: new Date().toISOString()
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                // تحديث حالة التغييرات المرفوعة
                await this.markChangesSynced(pendingChanges);
                console.log(`[SyncManager] تم رفع ${result.pushedCount || pendingChanges.length} تغيير`);
            } else {
                throw new Error('فشل رفع التغييرات');
            }
        } catch (error) {
            console.error('[SyncManager] فشل رفع التغييرات:', error);
            throw error;
        }
    }
    
    async pullChanges() {
        try {
            const lastSync = this.config.lastSyncAt || new Date(0).toISOString();
            
            const response = await fetch(`${this.config.managerUrl}/api/sync/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.config.deviceId,
                    lastSyncAt: lastSync,
                    timestamp: new Date().toISOString()
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                const changes = result.changes || [];
                
                if (changes.length > 0) {
                    console.log(`[SyncManager] سحب ${changes.length} تغيير من المدير`);
                    await this.applyChanges(changes);
                }
                
                return changes;
            }
        } catch (error) {
            console.error('[SyncManager] فشل سحب التغييرات:', error);
            throw error;
        }
        return [];
    }
    
    // ============================================================
    // إدارة التغييرات المحلية
    // ============================================================
    
    async getPendingChanges() {
        // جمع التغييرات من localStorage
        const pending = [];
        
        try {
            // تغييرات currentCase
            const currentCase = localStorage.getItem('currentCase');
            if (currentCase) {
                const parsed = JSON.parse(currentCase);
                if (parsed.updatedAt && (!this.config.lastSyncAt || parsed.updatedAt > this.config.lastSyncAt)) {
                    pending.push({
                        type: 'case_update',
                        data: parsed,
                        timestamp: parsed.updatedAt
                    });
                }
            }
            
            // تغييرات من change_log (إذا كان موجوداً)
            const changeLog = localStorage.getItem('change_log');
            if (changeLog) {
                const logs = JSON.parse(changeLog);
                const unsynced = logs.filter(log => !log.synced);
                pending.push(...unsynced);
            }
            
            // تغييرات من special_cases
            const specialCases = localStorage.getItem('special_cases');
            if (specialCases) {
                const parsed = JSON.parse(specialCases);
                pending.push({
                    type: 'special_cases',
                    data: parsed,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('[SyncManager] خطأ في جمع التغييرات المعلقة:', error);
        }
        
        return pending;
    }
    
    async markChangesSynced(changes) {
        // تحديث حالة التغييرات في localStorage
        try {
            const changeLog = localStorage.getItem('change_log');
            if (changeLog) {
                let logs = JSON.parse(changeLog);
                const changeIds = changes.map(c => c.id).filter(Boolean);
                logs = logs.map(log => ({
                    ...log,
                    synced: changeIds.includes(log.id) ? true : log.synced
                }));
                localStorage.setItem('change_log', JSON.stringify(logs));
            }
        } catch (error) {
            console.error('[SyncManager] خطأ في تحديث حالة التغييرات:', error);
        }
    }
    
    async applyChanges(changes) {
        // تطبيق التغييرات المستلمة من المدير
        for (const change of changes) {
            try {
                switch (change.type) {
                    case 'case_update':
                        // تحديث الحالة المحلية
                        if (change.data && change.data.caseId) {
                            const currentCase = localStorage.getItem('currentCase');
                            if (currentCase) {
                                const parsed = JSON.parse(currentCase);
                                if (!parsed.updatedAt || change.timestamp > parsed.updatedAt) {
                                    localStorage.setItem('currentCase', JSON.stringify(change.data));
                                    console.log(`[SyncManager] تم تحديث الحالة ${change.data.caseId}`);
                                }
                            }
                        }
                        break;
                        
                    case 'special_cases':
                        localStorage.setItem('special_cases', JSON.stringify(change.data));
                        break;
                        
                    default:
                        console.log(`[SyncManager] نوع تغيير غير معروف: ${change.type}`);
                }
            } catch (error) {
                console.error('[SyncManager] خطأ في تطبيق التغيير:', error);
                this.emit('conflictDetected', { change, error: error.message });
            }
        }
    }
    
    // ============================================================
    // واجهة المستخدم (للاتصال من الواجهة)
    // ============================================================
    
    async addChange(change) {
        // إضافة تغيير جديد لقائمة الانتظار
        try {
            const changeLog = localStorage.getItem('change_log');
            let logs = changeLog ? JSON.parse(changeLog) : [];
            
            logs.push({
                ...change,
                id: Date.now(),
                synced: false,
                deviceId: this.config.deviceId
            });
            
            localStorage.setItem('change_log', JSON.stringify(logs));
            
            // محاولة مزامنة فورية
            this.sync();
            
            return true;
        } catch (error) {
            console.error('[SyncManager] خطأ في إضافة التغيير:', error);
            return false;
        }
    }
    
    async forceSync() {
        //强制执行一次同步
        await this.sync();
        return this.getStatus();
    }
    
    getStatus() {
        return {
            deviceRole: this.config.deviceRole,
            managerUrl: this.config.managerUrl,
            deviceId: this.config.deviceId,
            syncStatus: this.config.syncStatus,
            lastSyncAt: this.config.lastSyncAt,
            pendingChanges: this.config.pendingChanges.length,
            syncError: this.config.syncError
        };
    }
    
    setManagerUrl(url) {
        this.config.managerUrl = url;
        this.saveConfig();
        // محاولة مزامنة فورية
        this.sync();
    }
    
    // ============================================================
    // نسخ احتياطي إلى TeraBox (للمدير فقط)
    // ============================================================
    
    async backupToCloud() {
        if (this.config.deviceRole !== 'manager') {
            console.warn('[SyncManager] النسخ الاحتياطي متاح فقط لجهاز المدير');
            return { success: false, message: 'متاح فقط للمدير' };
        }
        
        try {
            // جمع جميع البيانات
            const backupData = {
                timestamp: new Date().toISOString(),
                deviceId: this.config.deviceId,
                cases: await this.getAllCases(),
                specialCases: JSON.parse(localStorage.getItem('special_cases') || '[]'),
                users: JSON.parse(localStorage.getItem('users') || '[]'),
                settings: JSON.parse(localStorage.getItem('system_config') || '{}')
            };
            
            // تحويل إلى JSON
            const jsonData = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            
            // إنشاء ملف للتحميل
            const filename = `backup_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.json`;
            
            // محاولة رفع إلى TeraBox عبر API (إذا كان متاحاً)
            if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.uploadToTerabox) {
                const result = await window.electronAPI.uploadToTerabox({
                    filename,
                    data: jsonData
                });
                return result;
            } else {
                // تنزيل محلي كبديل
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                return { success: true, message: 'تم إنشاء نسخة احتياطية محلية', filename };
            }
            
        } catch (error) {
            console.error('[SyncManager] فشل النسخ الاحتياطي:', error);
            return { success: false, message: error.message };
        }
    }
    
    async getAllCases() {
        // جمع جميع الحالات من localStorage
        const cases = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('case_')) {
                try {
                    const caseData = JSON.parse(localStorage.getItem(key));
                    cases.push(caseData);
                } catch (error) {
                    // تجاهل
                }
            }
        }
        return cases;
    }
    
    // ============================================================
    // إدارة الأحداث
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
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ============================================================
    // التصدير
    // ============================================================
    
    getAPI() {
        return {
            sync: () => this.sync(),
            forceSync: () => this.forceSync(),
            getStatus: () => this.getStatus(),
            setManagerUrl: (url) => this.setManagerUrl(url),
            backupToCloud: () => this.backupToCloud(),
            addChange: (change) => this.addChangeChange,
            getPendingChanges: () => this.getPendingChanges(),
            discoverManager: () => this.discoverManager(),
            on: (event, callback) => this.on(event, callback)
        };
    }
}

// ============================================================
// إنشاء نسخة واحدة من مدير المزامنة
// ============================================================
const syncManager = new SyncManager();

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = syncManager;
    module.exports.SyncManager = SyncManager;
} else {
    window.syncManager = syncManager;
    window.SyncManager = SyncManager;
}
