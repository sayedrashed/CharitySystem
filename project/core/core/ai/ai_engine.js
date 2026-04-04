// core/ai/ai_engine.js
// محرك الذكاء الاصطناعي - الاتصال بـ Ollama (Qwen2.5)

const AI_BASE_URL = 'http://localhost:11434';
const AI_MODEL = 'qwen2.5:7b'; // أو qwen2.5:1.5b للأجهزة الأقل قوة

/**
 * إرسال سؤال إلى نموذج Qwen2.5
 * @param {string} prompt - السؤال أو الأمر
 * @param {Object} options - خيارات إضافية
 * @returns {Promise<string>} - الرد من النموذج
 */
async function askAI(prompt, options = {}) {
    const {
        temperature = 0.7,
        maxTokens = 500,
        stream = false
    } = options;

    try {
        const response = await fetch(`${AI_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: AI_MODEL,
                prompt: prompt,
                stream: stream,
                temperature: temperature,
                max_tokens: maxTokens
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.response || '';
    } catch (error) {
        console.error('[AI Engine] خطأ في الاتصال بـ Ollama:', error);
        return '';
    }
}

/**
 * استخراج الاسم والرقم من رسالة الحالة
 * @param {string} message - رسالة الحالة
 * @returns {Promise<{name: string|null, number: string|null}>}
 */
async function extractCaseInfo(message) {
    const prompt = `
    أنت مساعد ذكي لإدارة الحالات في جمعية خيرية.
    
    المهمة: استخراج اسم الحالة ورقمها من الرسالة التالية.
    
    الرسالة: "${message}"
    
    قم بتحليل الرسالة واستخرج:
    1. الاسم الكامل للحالة (إن وجد)
    2. الرقم (م.ع أو م.م) (إن وجد)
    
    أعد الإجابة بصيغة JSON فقط (بدون أي نص إضافي):
    {
        "name": "اسم الحالة أو null",
        "number": "الرقم أو null"
    }
    `;

    const response = await askAI(prompt, { temperature: 0.3, maxTokens: 150 });
    
    try {
        // محاولة استخراج JSON من الرد
        const jsonMatch = response.match(/\{.*\}/s);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            return {
                name: data.name === 'null' ? null : data.name,
                number: data.number === 'null' ? null : data.number
            };
        }
    } catch (e) {
        console.error('[AI Engine] فشل parsing JSON:', e);
    }
    
    // إذا فشل AI، نستخدم الطريقة التقليدية
    return extractCaseInfoTraditional(message);
}

/**
 * استخراج الاسم والرقم بالطريقة التقليدية (بدون AI)
 */
function extractCaseInfoTraditional(message) {
    const numbers = message.match(/\d+/g);
    const number = numbers ? numbers[0] : null;
    
    let name = message.replace(/\d+/g, '').trim();
    // إزالة التحيات الشائعة
    const greetings = ['السلام عليكم', 'وعليكم السلام', 'صباح الخير', 'مساء الخير', 'تحياتي'];
    greetings.forEach(g => {
        name = name.replace(g, '');
    });
    name = name.replace(/[^أ-ي\s]/g, '').trim();
    
    return { name: name || null, number };
}

/**
 * توليد رد للحالة بناءً على بياناتها
 * @param {Object} caseData - بيانات الحالة من قاعدة البيانات
 * @returns {Promise<string>}
 */
async function generateReply(caseData) {
    if (!caseData) {
        return "❌ الحالة غير موجودة في قاعدة البيانات. يرجى التأكد من الاسم أو الرقم.";
    }

    const status = caseData.status;
    const name = caseData.name;
    const number = caseData.serial_global || caseData.serial_accounting;
    const amount = caseData.amount || caseData.monthly_amount || 0;

    switch (status) {
        case 'مقبولة':
            return `✅ تم تجهيز قبضك للحالة: ${name} (م.ع ${number})\n📍 المبلغ: ${amount} جنيه\n🖨️ يرجى التوجه لاستلامه من مكتب الصرف`;
        case 'موقوفة':
            return `⚠️ الحالة ${name} موقوفة حالياً، يرجى التواصل مع الباحث`;
        case 'معلقة':
            return `⚠️ الحالة ${name} معلقة حالياً، يرجى التواصل مع الباحث`;
        case 'ملغاة':
            return `⚠️ الحالة ${name} ملغاة، لا يمكن صرف مساعدة`;
        default:
            return `❓ الحالة ${name} غير مقبولة حالياً (الحالة: ${status}). يرجى التواصل مع الباحث`;
    }
}

/**
 * تحليل مشاعر الحالة من رسالتها
 * @param {string} message 
 * @returns {Promise<{sentiment: string, confidence: number}>}
 */
async function analyzeSentiment(message) {
    const prompt = `
    حلل مشاعر المتحدث في هذه الرسالة: "${message}"
    أعد JSON فقط: {"sentiment": "positive/negative/neutral", "confidence": 0.0-1.0}
    `;
    
    const response = await askAI(prompt, { temperature: 0.3, maxTokens: 100 });
    try {
        const jsonMatch = response.match(/\{.*\}/s);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (e) {}
    
    return { sentiment: 'neutral', confidence: 0.5 };
}

/**
 * توليد تقرير ذكي عن حالة معينة
 * @param {Object} caseData 
 * @returns {Promise<string>}
 */
async function generateSmartReport(caseData) {
    const prompt = `
    أنت محلل اجتماعي خبير.
    
    بناءً على بيانات الحالة التالية، اكتب تقريراً موجزاً (3-4 جمل) يلخص وضع الحالة ويقدم توصيات:
    
    الاسم: ${caseData.name}
    الرقم: ${caseData.serial_global}
    الحالة: ${caseData.status}
    المبلغ الشهري: ${caseData.monthly_amount || 0} جنيه
    الدخل الشهري: ${caseData.income || 'غير محدد'} جنيه
    عدد أفراد الأسرة: ${caseData.family_size || 'غير محدد'}
    
    التقرير:
    `;
    
    return await askAI(prompt, { temperature: 0.5, maxTokens: 300 });
}

// تصدير الدوال
if (typeof module !== 'undefined') {
    module.exports = {
        askAI,
        extractCaseInfo,
        extractCaseInfoTraditional,
        generateReply,
        analyzeSentiment,
        generateSmartReport
    };
} else {
    window.AIEngine = {
        askAI,
        extractCaseInfo,
        extractCaseInfoTraditional,
        generateReply,
        analyzeSentiment,
        generateSmartReport
    };
}
