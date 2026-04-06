// =====================================================================
// utils/print_manager.js
// مدير الطباعة - إدارة الطباعة والبحث عن الطابعات
// المرجع: PROJECT_CONTEXT.txt
// المهام:
// 1. البحث عن الطابعات المتاحة (محلياً وعبر الشبكة)
// 2. طباعة المستندات (PDF، HTML)
// 3. إدارة قائمة انتظار الطباعة
// 4. مراقبة حالة الطابعات (حبر، ورق)
// =====================================================================

class PrintManager {
    constructor() {
        // تكوين الطباعة
        this.config = {
            defaultPrinter: null,
            pageMargin: 15,        // مم
            paperSize: 'A4',
            orientation: 'portrait', // portrait / landscape
            autoSelectPrinter: true
        };
        
        // قائمة الطابعات المتاحة
        this.printers = [];
        
        // قائمة انتظار الطباعة
        this.printQueue = [];
        
        // سجل الطباعة
        this.printHistory = [];
        
        // مستمعي الأحداث
        this.listeners = {
            'printersUpdated': [],
            'printStarted': [],
            'printCompleted': [],
            'printFailed': [],
            'printerStatusChanged': []
        };
        
        // تهيئة
        this.init();
    }
    
    // ============================================================
    // التهيئة
    // ============================================================
    
    async init() {
        console.log('[PrintManager] تهيئة مدير الطباعة...');
        
        // تحميل الإعدادات
        this.loadConfig();
        
        // اكتشاف الطابعات
        await this.discoverPrinters();
        
        // بدء مراقبة حالة الطابعات
        this.startPrinterMonitor();
        
        console.log('[PrintManager] تم تهيئة مدير الطباعة بنجاح');
    }
    
    loadConfig() {
        try {
            const saved = localStorage.getItem('print_manager_config');
            if (saved) {
                this.config = { ...this.config, ...JSON.parse(saved) };
            }
        } catch (error) {
            console.error('[PrintManager] خطأ في تحميل الإعدادات:', error);
        }
    }
    
    saveConfig() {
        try {
            localStorage.setItem('print_manager_config', JSON.stringify(this.config));
        } catch (error) {
            console.error('[PrintManager] خطأ في حفظ الإعدادات:', error);
        }
    }
    
    // ============================================================
    // اكتشاف الطابعات
    // ============================================================
    
    async discoverPrinters() {
        console.log('[PrintManager] جاري اكتشاف الطابعات...');
        
        const printers = [];
        
        // 1. الطابعات المحلية (عبر API المتصفح)
        if (typeof window !== 'undefined' && window.electronAPI) {
            try {
                const localPrinters = await window.electronAPI.getPrinters();
                if (localPrinters && localPrinters.length) {
                    printers.push(...localPrinters.map(p => ({
                        ...p,
                        type: 'local',
                        status: 'unknown'
                    })));
                }
            } catch (error) {
                console.error('[PrintManager] فشل جلب الطابعات المحلية:', error);
            }
        }
        
        // 2. الطابعات عبر الشبكة (إذا كان هناك خادم)
        try {
            const response = await fetch('/api/printers/discover', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const networkPrinters = await response.json();
                printers.push(...networkPrinters.map(p => ({
                    ...p,
                    type: 'network',
                    status: 'unknown'
                })));
            }
        } catch (error) {
            // تجاهل - قد لا يكون الخادم متاحاً
        }
        
        // 3. طابعات افتراضية (إذا لم يتم اكتشاف أي طابعة)
        if (printers.length === 0) {
            printers.push({
                id: 'default',
                name: 'الطابعة الافتراضية',
                type: 'virtual',
                status: 'ready',
                isDefault: true
            });
        }
        
        this.printers = printers;
        this.emit('printersUpdated', { printers: this.printers });
        
        console.log(`[PrintManager] تم اكتشاف ${printers.length} طابعة`);
        return printers;
    }
    
    async getPrinterStatus(printerId) {
        // الحصول على حالة طابعة معينة
        const printer = this.printers.find(p => p.id === printerId);
        if (!printer) return null;
        
        if (printer.type === 'virtual') {
            return { status: 'ready', level: 100, paper: true };
        }
        
        try {
            if (typeof window !== 'undefined' && window.electronAPI) {
                const status = await window.electronAPI.getPrinterStatus(printerId);
                return status;
            }
        } catch (error) {
            console.error('[PrintManager] فشل جلب حالة الطابعة:', error);
        }
        
        return { status: 'unknown', level: null, paper: null };
    }
    
    async checkAllPrintersStatus() {
        for (const printer of this.printers) {
            const status = await this.getPrinterStatus(printer.id);
            if (status) {
                printer.status = status.status;
                printer.inkLevel = status.level;
                printer.hasPaper = status.paper;
                this.emit('printerStatusChanged', { printerId: printer.id, status });
            }
        }
        return this.printers;
    }
    
    startPrinterMonitor() {
        // مراقبة حالة الطابعات كل 30 ثانية
        setInterval(async () => {
            await this.checkAllPrintersStatus();
        }, 30000);
    }
    
    // ============================================================
    // الطباعة
    // ============================================================
    
    async print(element, options = {}) {
        /**
         * طباعة عنصر HTML
         * @param {HTMLElement} element - العنصر المراد طباعته
         * @param {Object} options - خيارات الطباعة
         * @returns {Promise<boolean>}
         */
        
        const printerId = options.printerId || this.config.defaultPrinter;
        const printer = this.printers.find(p => p.id === printerId);
        
        if (!printer) {
            console.warn('[PrintManager] لا توجد طابعة متاحة');
            return false;
        }
        
        // إضافة إلى قائمة الانتظار
        const printJob = {
            id: Date.now(),
            type: 'element',
            element: element,
            options: options,
            printer: printer,
            status: 'queued',
            createdAt: new Date().toISOString()
        };
        
        this.printQueue.push(printJob);
        this.emit('printStarted', { jobId: printJob.id, printer: printer.name });
        
        // معالجة قائمة الانتظار
        await this.processPrintQueue();
        
        return true;
    }
    
    async printUrl(url, options = {}) {
        /**
         * طباعة صفحة من URL
         * @param {string} url - رابط الصفحة المراد طباعتها
         * @param {Object} options - خيارات الطباعة
         * @returns {Promise<boolean>}
         */
        
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
        
        return new Promise((resolve) => {
            iframe.onload = () => {
                try {
                    iframe.contentWindow.print();
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                        resolve(true);
                    }, 1000);
                } catch (error) {
                    console.error('[PrintManager] فشل طباعة URL:', error);
                    document.body.removeChild(iframe);
                    resolve(false);
                }
            };
            iframe.src = url;
        });
    }
    
    async printHtml(htmlContent, options = {}) {
        /**
         * طباعة محتوى HTML
         * @param {string} htmlContent - محتوى HTML
         * @param {Object} options - خيارات الطباعة
         * @returns {Promise<boolean>}
         */
        
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            console.error('[PrintManager] لا يمكن فتح نافذة الطباعة');
            return false;
        }
        
        printWindow.document.write(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>طباعة</title>
                <style>
                    @page { 
                        size: ${options.paperSize || this.config.paperSize};
                        margin: ${options.pageMargin || this.config.pageMargin}mm;
                    }
                    body {
                        font-family: 'Times New Roman', Times, serif;
                        margin: 0;
                        padding: 0;
                    }
                    @media print {
                        .no-print { display: none; }
                    }
                </style>
                ${options.styles || ''}
            </head>
            <body>
                ${htmlContent}
                <script>
                    window.onload = () => {
                        window.print();
                        setTimeout(() => window.close(), 1000);
                    };
                <\/script>
            </body>
            </html>
        `);
        
        printWindow.document.close();
        return true;
    }
    
    async printPdf(pdfUrl, options = {}) {
        /**
         * طباعة ملف PDF
         * @param {string} pdfUrl - رابط ملف PDF
         * @param {Object} options - خيارات الطباعة
         * @returns {Promise<boolean>}
         */
        
        // فتح PDF في iframe وطباعته
        const iframe = document.createElement('iframe');
        iframe.style.position = 'absolute';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
        
        return new Promise((resolve) => {
            iframe.onload = () => {
                try {
                    iframe.contentWindow.print();
                    setTimeout(() => {
                        document.body.removeChild(iframe);
                        resolve(true);
                    }, 2000);
                } catch (error) {
                    console.error('[PrintManager] فشل طباعة PDF:', error);
                    document.body.removeChild(iframe);
                    resolve(false);
                }
            };
            iframe.src = pdfUrl;
        });
    }
    
    // ============================================================
    // إدارة قائمة انتظار الطباعة
    // ============================================================
    
    async processPrintQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        while (this.printQueue.length > 0) {
            const job = this.printQueue.shift();
            if (!job) continue;
            
            job.status = 'printing';
            this.emit('printStarted', { jobId: job.id });
            
            try {
                let success = false;
                
                switch (job.type) {
                    case 'element':
                        success = await this._printElement(job.element, job.options);
                        break;
                    case 'url':
                        success = await this.printUrl(job.url, job.options);
                        break;
                    case 'html':
                        success = await this.printHtml(job.htmlContent, job.options);
                        break;
                    case 'pdf':
                        success = await this.printPdf(job.pdfUrl, job.options);
                        break;
                }
                
                if (success) {
                    job.status = 'completed';
                    job.completedAt = new Date().toISOString();
                    this.printHistory.unshift(job);
                    this.emit('printCompleted', { jobId: job.id });
                } else {
                    job.status = 'failed';
                    this.emit('printFailed', { jobId: job.id, error: 'فشل الطباعة' });
                }
                
            } catch (error) {
                job.status = 'failed';
                job.error = error.message;
                this.emit('printFailed', { jobId: job.id, error: error.message });
            }
            
            // الاحتفاظ بآخر 50 مهمة فقط
            if (this.printHistory.length > 50) {
                this.printHistory.pop();
            }
        }
        
        this.isProcessing = false;
    }
    
    async _printElement(element, options) {
        // طباعة عنصر HTML
        const originalTitle = document.title;
        const originalContents = document.body.innerHTML;
        
        // نسخ العنصر المراد طباعته
        const cloneElement = element.cloneNode(true);
        
        // إنشاء محتوى الطباعة
        const printContent = `
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>${options.title || document.title}</title>
                <style>
                    @page { 
                        size: ${options.paperSize || this.config.paperSize};
                        margin: ${options.pageMargin || this.config.pageMargin}mm;
                    }
                    body {
                        font-family: 'Times New Roman', Times, serif;
                        margin: 0;
                        padding: 0;
                    }
                    ${options.styles || ''}
                    @media print {
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                ${cloneElement.outerHTML}
            </body>
            </html>
        `;
        
        // فتح نافذة الطباعة
        const printWindow = window.open('', '_blank');
        if (!printWindow) return false;
        
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        return new Promise((resolve) => {
            printWindow.onload = () => {
                printWindow.print();
                setTimeout(() => {
                    printWindow.close();
                    resolve(true);
                }, 1000);
            };
        });
    }
    
    // ============================================================
    // إدارة الطابعات
    // ============================================================
    
    getPrinters() {
        return this.printers;
    }
    
    getDefaultPrinter() {
        return this.printers.find(p => p.id === this.config.defaultPrinter) || this.printers[0];
    }
    
    setDefaultPrinter(printerId) {
        this.config.defaultPrinter = printerId;
        this.saveConfig();
        
        // تحديث حالة isDefault للطابعات
        this.printers.forEach(p => {
            p.isDefault = (p.id === printerId);
        });
        
        this.emit('printersUpdated', { printers: this.printers });
    }
    
    async refreshPrinters() {
        return await this.discoverPrinters();
    }
    
    // ============================================================
    // إعدادات الطباعة
    // ============================================================
    
    getSettings() {
        return { ...this.config };
    }
    
    updateSettings(settings) {
        this.config = { ...this.config, ...settings };
        this.saveConfig();
        return this.config;
    }
    
    // ============================================================
    // سجل الطباعة
    // ============================================================
    
    getPrintHistory(limit = 20) {
        return this.printHistory.slice(0, limit);
    }
    
    clearPrintHistory() {
        this.printHistory = [];
    }
    
    getPrintQueue() {
        return this.printQueue.filter(job => job.status === 'queued');
    }
    
    cancelPrintJob(jobId) {
        const index = this.printQueue.findIndex(job => job.id === jobId);
        if (index !== -1) {
            this.printQueue.splice(index, 1);
            return true;
        }
        return false;
    }
    
    // ============================================================
    // طباعة بطاقات محددة
    // ============================================================
    
    async printZarf(caseData) {
        /**
         * طباعة ظرف قبض
         * @param {Object} caseData - بيانات الحالة
         * @returns {Promise<boolean>}
         */
        
        const htmlContent = `
            <div style="width: 150mm; height: 180mm; padding: 10mm; border: 1px solid #000; text-align: center;">
                <h2>${caseData.name}</h2>
                <p>رقم الحالة: ${caseData.caseSerial || caseData.id}</p>
                <p>المبلغ: ${caseData.amount || 0} جنيه</p>
                <p>الشهر: ${new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</p>
                <hr>
                <p>الجمعية الشرعية الرئيسية</p>
                <p>فرع الرحمن بمساكن حجازي</p>
                <p>مكتب عمر بن الخطاب بالعبور</p>
            </div>
        `;
        
        return await this.printHtml(htmlContent, { title: `ظرف قبض - ${caseData.name}` });
    }
    
    async printIdCard(caseData) {
        /**
         * طباعة كارنيه (بطاقة تعريف)
         * @param {Object} caseData - بيانات الحالة
         * @returns {Promise<boolean>}
         */
        
        const htmlContent = `
            <div style="width: 85.6mm; height: 54mm; border: 1px solid #000; border-radius: 3mm; padding: 3mm; display: flex;">
                <div style="flex: 1; text-align: center;">
                    <div style="width: 20mm; height: 30mm; border: 1px solid #999; margin: 0 auto;">
                        ${caseData.photo ? `<img src="${caseData.photo}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="text-align:center; line-height:30mm;">صورة</div>'}
                    </div>
                </div>
                <div style="flex: 2; padding-right: 5mm;">
                    <h3>${caseData.name}</h3>
                    <p>رقم الحالة: ${caseData.caseSerial || caseData.id}</p>
                    <p>العنوان: ${caseData.shortAddress || '---'}</p>
                    <p>الهاتف: ${caseData.phone || '---'}</p>
                </div>
            </div>
        `;
        
        return await this.printHtml(htmlContent, { title: `كارنيه - ${caseData.name}` });
    }
    
    async printCashList(casesList, month, year) {
        /**
         * طباعة بطاقة الكاش (قائمة الحالات)
         * @param {Array} casesList - قائمة الحالات
         * @param {string} month - الشهر
         * @param {number} year - السنة
         * @returns {Promise<boolean>}
         */
        
        let tableRows = '';
        casesList.forEach((c, index) => {
            tableRows += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${c.name}</td>
                    <td>${c.amount || 0}</td>
                    <td>${c.nationalId || '---'}</td>
                    <td>_______________</td>
                </tr>
            `;
        });
        
        const htmlContent = `
            <div style="direction: rtl;">
                <h2 style="text-align: center;">بطاقة الكاش - ${month} ${year}</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f0f0f0;">
                            <th style="border: 1px solid #000; padding: 8px;">م</th>
                            <th style="border: 1px solid #000; padding: 8px;">الاسم</th>
                            <th style="border: 1px solid #000; padding: 8px;">المبلغ</th>
                            <th style="border: 1px solid #000; padding: 8px;">الرقم القومي</th>
                            <th style="border: 1px solid #000; padding: 8px;">التوقيع</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        `;
        
        return await this.printHtml(htmlContent, { title: `بطاقة الكاش - ${month} ${year}` });
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
    
    // ============================================================
    // التصدير
    // ============================================================
    
    getAPI() {
        return {
            getPrinters: () => this.getPrinters(),
            getDefaultPrinter: () => this.getDefaultPrinter(),
            setDefaultPrinter: (id) => this.setDefaultPrinter(id),
            refreshPrinters: () => this.refreshPrinters(),
            print: (element, options) => this.print(element, options),
            printHtml: (html, options) => this.printHtml(html, options),
            printUrl: (url, options) => this.printUrl(url, options),
            printPdf: (url, options) => this.printPdf(url, options),
            printZarf: (caseData) => this.printZarf(caseData),
            printIdCard: (caseData) => this.printIdCard(caseData),
            printCashList: (cases, month, year) => this.printCashList(cases, month, year),
            getSettings: () => this.getSettings(),
            updateSettings: (settings) => this.updateSettings(settings),
            getPrintHistory: (limit) => this.getPrintHistory(limit),
            clearPrintHistory: () => this.clearPrintHistory(),
            getPrintQueue: () => this.getPrintQueue(),
            cancelPrintJob: (id) => this.cancelPrintJob(id)
        };
    }
}

// ============================================================
// إنشاء نسخة واحدة من مدير الطباعة
// ============================================================
const printManager = new PrintManager();

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = printManager;
    module.exports.PrintManager = PrintManager;
} else {
    window.printManager = printManager;
    window.PrintManager = PrintManager;
}
