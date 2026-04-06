// =====================================================================
// core/dynamic_loader.js
// المحمل الديناميكي للبطاقات والنماذج
// المرجع: PROJECT_CONTEXT.txt
// المبادئ: البطاقات ديناميكية وتقرأ تكوينها من currentCase.data.systemConfig
// =====================================================================

class DynamicLoader {
    constructor() {
        // تكوين البطاقات الافتراضي (سيتم دمجه مع systemConfig)
        this.defaultCardsConfig = {
            cards: [
                { id: 1, name: "مقدمة البحث", file: "cards/1.html", enabled: true, order: 1 },
                { id: 2, name: "البيانات الديموغرافية", file: "cards/2.html", enabled: true, order: 2 },
                { id: 3, name: "تعريف الأسرة", file: "cards/3.html", enabled: true, order: 3 },
                { id: 4, name: "بيانات الفرد", file: "cards/4.html", enabled: true, order: 4 },
                { id: 5, name: "الدخل والمصروفات", file: "cards/5.html", enabled: true, order: 5 },
                { id: 6, name: "تقرير الباحث", file: "cards/6.html", enabled: true, order: 6 },
                { id: 7, name: "التقرير الذكي", file: "cards/7.html", enabled: true, order: 7 },
                { id: 8, name: "توثيق المتبرع", file: "cards/8.html", enabled: true, order: 8 }
            ]
        };
    }

    /**
     * الحصول على تكوين البطاقات من systemConfig
     * @returns {Promise<Object>} - تكوين البطاقات
     */
    async getCardsConfig() {
        try {
            // محاولة قراءة التكوين من currentCase.data.systemConfig
            if (typeof window !== 'undefined' && window.currentCase?.data?.systemConfig?.cardsConfig) {
                const savedConfig = window.currentCase.data.systemConfig.cardsConfig;
                if (savedConfig && savedConfig.cards) {
                    return savedConfig;
                }
            }

            // محاولة قراءة من localStorage (احتياطي)
            const saved = localStorage.getItem('dynamic_cards_config');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.cards) {
                    return parsed;
                }
            }

            // إرجاع التكوين الافتراضي
            return { ...this.defaultCardsConfig };
        } catch (error) {
            console.error('[DynamicLoader] خطأ في قراءة تكوين البطاقات:', error);
            return { ...this.defaultCardsConfig };
        }
    }

    /**
     * حفظ تكوين البطاقات
     * @param {Object} config - تكوين البطاقات الجديد
     * @returns {Promise<boolean>}
     */
    async saveCardsConfig(config) {
        try {
            // حفظ في localStorage
            localStorage.setItem('dynamic_cards_config', JSON.stringify(config));

            // حفظ في currentCase.data.systemConfig إذا كان متاحاً
            if (typeof window !== 'undefined' && window.currentCase) {
                if (!window.currentCase.data.systemConfig) {
                    window.currentCase.data.systemConfig = {};
                }
                window.currentCase.data.systemConfig.cardsConfig = config;
                
                // إطلاق حدث لتحديث الواجهة
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('cardsConfigChanged', { detail: config }));
                }
            }

            console.log('[DynamicLoader] تم حفظ تكوين البطاقات');
            return true;
        } catch (error) {
            console.error('[DynamicLoader] خطأ في حفظ تكوين البطاقات:', error);
            return false;
        }
    }

    /**
     * الحصول على قائمة البطاقات (مرتبة حسب order)
     * @returns {Promise<Array>}
     */
    async getCardsList() {
        const config = await this.getCardsConfig();
        const cards = config.cards || [];
        
        // ترتيب حسب order
        return cards
            .filter(card => card.enabled !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * الحصول على بطاقة محددة
     * @param {number} cardId - معرف البطاقة
     * @returns {Promise<Object|null>}
     */
    async getCard(cardId) {
        const config = await this.getCardsConfig();
        const cards = config.cards || [];
        return cards.find(card => card.id === cardId) || null;
    }

    /**
     * إضافة بطاقة جديدة
     * @param {Object} card - { id, name, file, enabled, order }
     * @returns {Promise<boolean>}
     */
    async addCard(card) {
        const config = await this.getCardsConfig();
        if (!config.cards) config.cards = [];
        
        // التأكد من عدم وجود بطاقة بنفس id
        const exists = config.cards.some(c => c.id === card.id);
        if (exists) {
            console.warn(`[DynamicLoader] بطاقة بالمعرف ${card.id} موجودة مسبقاً`);
            return false;
        }
        
        config.cards.push(card);
        return await this.saveCardsConfig(config);
    }

    /**
     * تحديث بطاقة موجودة
     * @param {number} cardId - معرف البطاقة
     * @param {Object} updates - الحقول المطلوب تحديثها
     * @returns {Promise<boolean>}
     */
    async updateCard(cardId, updates) {
        const config = await this.getCardsConfig();
        const cards = config.cards || [];
        const index = cards.findIndex(c => c.id === cardId);
        
        if (index === -1) {
            console.warn(`[DynamicLoader] بطاقة بالمعرف ${cardId} غير موجودة`);
            return false;
        }
        
        cards[index] = { ...cards[index], ...updates };
        return await this.saveCardsConfig(config);
    }

    /**
     * حذف بطاقة
     * @param {number} cardId - معرف البطاقة
     * @returns {Promise<boolean>}
     */
    async deleteCard(cardId) {
        const config = await this.getCardsConfig();
        config.cards = (config.cards || []).filter(c => c.id !== cardId);
        return await this.saveCardsConfig(config);
    }

    /**
     * إعادة ترتيب البطاقات
     * @param {Array} orderedIds - قائمة معرفات البطاقات بالترتيب المطلوب
     * @returns {Promise<boolean>}
     */
    async reorderCards(orderedIds) {
        const config = await this.getCardsConfig();
        const cards = config.cards || [];
        
        // إنشاء خريطة للمعرفات
        const cardsMap = new Map();
        cards.forEach(card => cardsMap.set(card.id, card));
        
        // إعادة الترتيب
        const reordered = [];
        for (const id of orderedIds) {
            if (cardsMap.has(id)) {
                reordered.push(cardsMap.get(id));
                cardsMap.delete(id);
            }
        }
        
        // إضافة البطاقات المتبقية في النهاية
        cardsMap.forEach(card => reordered.push(card));
        
        // تحديث ترتيب كل بطاقة
        reordered.forEach((card, index) => {
            card.order = index + 1;
        });
        
        config.cards = reordered;
        return await this.saveCardsConfig(config);
    }

    /**
     * تحميل بطاقة في iframe
     * @param {HTMLIFrameElement} iframe - عنصر iframe
     * @param {string} cardFile - مسار ملف البطاقة
     * @param {Object} caseData - بيانات الحالة
     */
    loadCardInFrame(iframe, cardFile, caseData) {
        if (!iframe || !cardFile) return;
        
        // تعيين المصدر
        iframe.src = cardFile;
        
        // إرسال البيانات بعد تحميل الإطار
        const sendData = () => {
            if (iframe.contentWindow && caseData) {
                iframe.contentWindow.postMessage({
                    type: 'LOAD_CURRENT_CASE',
                    data: caseData,
                    fullCase: { data: caseData }
                }, '*');
            }
        };
        
        // الاستماع لحدث تحميل الإطار
        iframe.addEventListener('load', sendData, { once: true });
        
        // محاولة فورية أيضاً (لحالة iframe محمل مسبقاً)
        setTimeout(sendData, 100);
    }

    /**
     * استلام البيانات من البطاقة
     * @param {MessageEvent} event - حدث postMessage
     * @returns {Object|null} - البيانات المستلمة
     */
    handleCardMessage(event) {
        const { type, data, fieldPath, value, cardId } = event.data || {};
        
        if (type === 'FIELD_UPDATE' && fieldPath !== undefined) {
            return { type: 'field_update', fieldPath, value };
        }
        
        if (type === 'COLLECT_DATA') {
            return { type: 'collect_data', data };
        }
        
        if (type === 'CARD_READY') {
            return { type: 'card_ready', cardId };
        }
        
        return null;
    }

    /**
     * إرسال أمر إلى البطاقة الحالية
     * @param {HTMLIFrameElement} iframe - عنصر iframe
     * @param {string} command - الأمر المرسل
     * @param {Object} data - البيانات المرسلة
     */
    sendToCard(iframe, command, data = {}) {
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: command,
                ...data
            }, '*');
        }
    }

    /**
     * طلب جمع البيانات من البطاقة الحالية
     * @param {HTMLIFrameElement} iframe - عنصر iframe
     */
    requestCardData(iframe) {
        this.sendToCard(iframe, 'COLLECT_DATA');
    }

    /**
     * إعادة تعيين التكوين إلى الوضع الافتراضي
     * @returns {Promise<boolean>}
     */
    async resetToDefault() {
        return await this.saveCardsConfig({ ...this.defaultCardsConfig });
    }

    /**
     * تصدير تكوين البطاقات (للنسخ الاحتياطي)
     * @returns {Promise<Object>}
     */
    async exportConfig() {
        return await this.getCardsConfig();
    }

    /**
     * استيراد تكوين بطاقات (من نسخة احتياطية)
     * @param {Object} config - التكوين المستورد
     * @returns {Promise<boolean>}
     */
    async importConfig(config) {
        if (!config || !config.cards) {
            console.error('[DynamicLoader] تكوين غير صالح');
            return false;
        }
        return await this.saveCardsConfig(config);
    }
}

// إنشاء نسخة واحدة من المحمل
const dynamicLoader = new DynamicLoader();

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = dynamicLoader;
    module.exports.DynamicLoader = DynamicLoader;
} else {
    window.dynamicLoader = dynamicLoader;
    window.DynamicLoader = DynamicLoader;
}
