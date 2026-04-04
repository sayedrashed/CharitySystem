// core/network/connection_monitor.js
// مراقبة الاتصال بالإنترنت والمزامنة مع جهاز المدير

class ConnectionMonitor {
    constructor(options = {}) {
        this.serverUrl = options.serverUrl || 'http://192.168.1.101:3000';
        this.checkInterval = options.checkInterval || 30000; // 30 ثانية
        this.isOnline = navigator.onLine;
        this.isServerReachable = false;
        this.pendingRequests = [];
        this.listeners = {
            'statusChange': [],
            'syncComplete': [],
            'syncFailed': []
        };
        
        this.init();
    }

    init() {
        // مراقبة تغيير حالة الاتصال
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // فحص دوري للاتصال بالخادم
        this.startPeriodicCheck();
        
        // محاولة إرسال الطلبات المعلقة عند الاتصال
        this.checkPendingRequests();
        
        console.log('[ConnectionMonitor] تم التهيئة');
    }

    handleOnline() {
        this.isOnline = true;
        this.emit('statusChange', { online: true, server: this.isServerReachable });
        console.log('[ConnectionMonitor] الاتصال بالإنترنت متاح');
        
        // فحص الخادم عند عودة الإنترنت
        this.checkServer();
        
        // محاولة إرسال الطلبات المعلقة
        this.processPendingRequests();
    }

    handleOffline() {
        this.isOnline = false;
        this.isServerReachable = false;
        this.emit('statusChange', { online: false, server: false });
        console.log('[ConnectionMonitor] انقطع الاتصال بالإنترنت');
    }

    async checkServer() {
        if (!this.isOnline) {
            this.isServerReachable = false;
            return false;
        }
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.serverUrl}/api/health`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            const wasReachable = this.isServerReachable;
            this.isServerReachable = response.ok;
            
            if (!wasReachable && this.isServerReachable) {
                console.log('[ConnectionMonitor] الخادم متاح الآن');
                this.emit('statusChange', { online: this.isOnline, server: true });
                this.processPendingRequests();
            } else if (wasReachable && !this.isServerReachable) {
                console.log('[ConnectionMonitor] الخادم غير متاح');
                this.emit('statusChange', { online: this.isOnline, server: false });
            }
            
            return this.isServerReachable;
        } catch (error) {
            if (this.isServerReachable) {
                console.log('[ConnectionMonitor] فقد الاتصال بالخادم');
                this.isServerReachable = false;
                this.emit('statusChange', { online: this.isOnline, server: false });
            }
            return false;
        }
    }

    startPeriodicCheck() {
        setInterval(async () => {
            await this.checkServer();
        }, this.checkInterval);
    }

    async syncData(data, endpoint, options = {}) {
        const { priority = 'normal', maxRetries = 3, retryDelay = 5000 } = options;
        
        const request = {
            id: this.generateRequestId(),
            endpoint,
            data,
            priority,
            maxRetries,
            retryDelay,
            attempts: 0,
            timestamp: Date.now(),
            status: 'pending'
        };
        
        // إذا كان الاتصال متاحاً، حاول الإرسال فوراً
        if (this.isOnline && this.isServerReachable) {
            try {
                const result = await this.sendRequest(request);
                return result;
            } catch (error) {
                console.error('[ConnectionMonitor] فشل الإرسال الفوري:', error);
                this.queueRequest(request);
                throw error;
            }
        } else {
            this.queueRequest(request);
            throw new Error('لا يوجد اتصال بالخادم. تم حفظ الطلب للمزامنة لاحقاً.');
        }
    }

    async sendRequest(request) {
        request.attempts++;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(`${this.serverUrl}${request.endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request.data),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            request.status = 'completed';
            this.removePendingRequest(request.id);
            this.emit('syncComplete', { requestId: request.id, result });
            
            return result;
        } catch (error) {
            console.error(`[ConnectionMonitor] فشل إرسال الطلب ${request.id}:`, error);
            
            if (request.attempts < request.maxRetries) {
                request.status = 'pending';
                this.savePendingRequests();
                
                // إعادة المحاولة بعد تأخير
                setTimeout(() => {
                    this.sendRequest(request).catch(() => {});
                }, request.retryDelay);
                
                throw error;
            } else {
                request.status = 'failed';
                this.savePendingRequests();
                this.emit('syncFailed', { requestId: request.id, error });
                throw new Error('فشل الإرسال بعد عدة محاولات');
            }
        }
    }

    queueRequest(request) {
        this.pendingRequests.push(request);
        this.savePendingRequests();
        console.log(`[ConnectionMonitor] تم إضافة طلب ${request.id} إلى قائمة الانتظار`);
    }

    async processPendingRequests() {
        if (!this.isOnline || !this.isServerReachable) {
            console.log('[ConnectionMonitor] لا يمكن معالجة الطلبات المعلقة - لا اتصال');
            return;
        }
        
        const pending = [...this.pendingRequests];
        console.log(`[ConnectionMonitor] معالجة ${pending.length} طلب معلق`);
        
        for (const request of pending) {
            if (request.status === 'pending') {
                try {
                    await this.sendRequest(request);
                } catch (error) {
                    console.error(`[ConnectionMonitor] فشل معالجة الطلب ${request.id}:`, error);
                }
            }
        }
    }

    checkPendingRequests() {
        // محاولة إرسال الطلبات المعلقة بشكل دوري عند الاتصال
        setInterval(() => {
            if (this.isOnline && this.isServerReachable && this.pendingRequests.length > 0) {
                this.processPendingRequests();
            }
        }, 60000); // كل دقيقة
    }

    queueRequest(request) {
        this.pendingRequests.push(request);
        this.savePendingRequests();
        console.log(`[ConnectionMonitor] تم إضافة طلب ${request.id} إلى قائمة الانتظار (${this.pendingRequests.length} طلبات معلقة)`);
    }

    async processPendingRequests() {
        if (!this.isOnline || !this.isServerReachable) {
            console.log('[ConnectionMonitor] لا يمكن معالجة الطلبات المعلقة - لا اتصال');
            return;
        }
        
        const pending = [...this.pendingRequests];
        if (pending.length === 0) return;
        
        console.log(`[ConnectionMonitor] معالجة ${pending.length} طلب معلق`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const request of pending) {
            if (request.status === 'pending') {
                try {
                    await this.sendRequest(request);
                    successCount++;
                } catch (error) {
                    failCount++;
                    console.error(`[ConnectionMonitor] فشل معالجة الطلب ${request.id}:`, error);
                }
            }
        }
        
        if (successCount > 0) {
            this.emit('syncComplete', { successCount, failCount });
        }
    }

    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    savePendingRequests() {
        try {
            localStorage.setItem('pending_requests', JSON.stringify(this.pendingRequests));
        } catch (error) {
            console.error('[ConnectionMonitor] فشل حفظ الطلبات المعلقة:', error);
        }
    }

    loadPendingRequests() {
        try {
            const saved = localStorage.getItem('pending_requests');
            if (saved) {
                this.pendingRequests = JSON.parse(saved);
                console.log(`[ConnectionMonitor] تم تحميل ${this.pendingRequests.length} طلب معلق`);
            }
        } catch (error) {
            console.error('[ConnectionMonitor] فشل تحميل الطلبات المعلقة:', error);
            this.pendingRequests = [];
        }
    }

    removePendingRequest(requestId) {
        this.pendingRequests = this.pendingRequests.filter(r => r.id !== requestId);
        this.savePendingRequests();
    }

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

    getStatus() {
        return {
            online: this.isOnline,
            serverReachable: this.isServerReachable,
            pendingRequests: this.pendingRequests.length,
            serverUrl: this.serverUrl
        };
    }
}

// إنشاء نسخة واحدة من المراقب
let connectionMonitor = null;

function getConnectionMonitor(options = {}) {
    if (!connectionMonitor) {
        connectionMonitor = new ConnectionMonitor(options);
        connectionMonitor.loadPendingRequests();
    }
    return connectionMonitor;
}

// تصدير للاستخدام
if (typeof module !== 'undefined') {
    module.exports = { ConnectionMonitor, getConnectionMonitor };
} else {
    window.ConnectionMonitor = ConnectionMonitor;
    window.getConnectionMonitor = getConnectionMonitor;
}
