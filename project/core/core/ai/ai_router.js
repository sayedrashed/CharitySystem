// core/ai/ai_router.js
// توجيه الأسئلة - يقرر أي نموذج يستخدم (محلي أم عن بعد)

const LOCAL_MODEL = 'qwen2.5:0.5b';
const REMOTE_URL = 'http://192.168.1.101:3000/api/ai/ask';

// كلمات تدل على أن السؤال معقد ويحتاج إلى نموذج المدير
const COMPLEX_KEYWORDS = [
    'حلل', 'تقرير', 'إحصاء', 'مقارنة', 'توقع', 'تنبؤ',
    'تحليل', 'إحصائيات', 'متوسط', 'اتجاه', 'تطور',
    'ملخص', 'توصية', 'اقتراح', 'خطة', 'استراتيجية'
];

// كلمات تدل على أن السؤال بسيط ويمكن معالجته محلياً
const SIMPLE_KEYWORDS = [
    'أين', 'كم', 'متى', 'ما هو', 'أخبرني', 'عرفني',
    'رقم', 'اسم', 'حالة', 'مبلغ', 'تاريخ'
];

/**
 * تحديد ما إذا كان السؤال معقداً
 * @param {string} question 
 * @returns {boolean}
 */
function isComplexQuestion(question) {
    const lowerQuestion = question.toLowerCase();
    
    // إذا كان السؤال يحتوي على كلمات معقدة
    for (const keyword of COMPLEX_KEYWORDS) {
        if (lowerQuestion.includes(keyword)) {
            return true;
        }
    }
    
    // إذا كان السؤال طويلاً (أكثر من 50 كلمة)
    if (question.split(' ').length > 50) {
        return true;
    }
    
    return false;
}

/**
 * تحديد ما إذا كان السؤال يحتاج إلى بيانات من قاعدة البيانات
 * @param {string} question 
 * @returns {boolean}
 */
function needsDatabase(question) {
    const lowerQuestion = question.toLowerCase();
    const dbKeywords = ['حالة', 'رقم', 'اسم', 'مبلغ', 'صرف', 'قبض', 'ظرف'];
    
    for (const keyword of dbKeywords) {
        if (lowerQuestion.includes(keyword)) {
            return true;
        }
    }
    return false;
}

/**
 * الاتصال بالنموذج المحلي (على نفس الجهاز)
 * @param {string} question 
 * @returns {Promise<string>}
 */
async function askLocalAI(question) {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type':application/json' },
            body: JSON.stringify({
                model: LOCAL_MODEL,
                prompt: question,
                stream: false,
                temperature: 0.7,
                max_tokens: 300
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.response || '';
        }
    } catch (error) {
        console.error('[AIRouter] خطأ في النموذج المحلي:', error);
    }
    return '';
}

/**
 * الاتصال بنموذج المدير (عن بعد)
 * @param {string} question 
 * @returns {Promise<string>}
 */
async function askRemoteAI(question) {
    try {
        const response = await fetch(REMOTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        
        if (response.ok) {
            const data = await response.json();
            return data.answer || '';
        }
    } catch (error) {
        console.error('[AIRouter] فشل الاتصال بالمدير:', error);
        // في حالة فشل الاتصال، نستخدم النموذج المحلي كبديل
        return await askLocalAI(question);
    }
    return '';
}

/**
 * توجيه السؤال إلى النموذج المناسب
 * @param {string} question 
 * @param {Object} context - سياق السؤال (مثل بيانات المستخدم)
 * @returns {Promise<{answer: string, source: string}>}
 */
async function routeQuestion(question, context = {}) {
    const startTime = Date.now();
    let answer = '';
    let source = 'unknown';
    
    // إذا كان السؤال معقداً → استخدم نموذج المدير
    if (isComplexQuestion(question)) {
        answer = await askRemoteAI(question);
        source = 'remote';
    } 
    // إذا كان السؤال بسيطاً → استخدم النموذج المحلي
    else {
        answer = await askLocalAI(question);
        source = 'local';
    }
    
    // إذا لم نحصل على إجابة، نحاول بالطريقة الأخرى
    if (!answer && source === 'local') {
        answer = await askRemoteAI(question);
        source = 'remote_fallback';
    } else if (!answer && source === 'remote') {
        answer = await askLocalAI(question);
        source = 'local_fallback';
    }
    
    const duration = Date.now() - startTime;
    console.log(`[AIRouter] سؤال: "${question.substring(0, 50)}..." | المصدر: ${source} | الزمن: ${duration}ms`);
    
    return {
        answer: answer || 'عذراً، لم أتمكن من معالجة سؤالك حالياً. يرجى المحاولة مرة أخرى.',
        source,
        duration
    };
}

/**
 * معالجة سؤال يحتاج إلى بيانات من قاعدة البيانات
 * @param {string} question 
 * @param {Object} db - قاعدة البيانات
 * @returns {Promise<string>}
 */
async function handleDatabaseQuestion(question, db) {
    // استخراج الرقم أو الاسم من السؤال
    const numbers = question.match(/\d+/g);
    const number = numbers ? numbers[0] : null;
    
    // البحث عن الحالة في قاعدة البيانات
    if (number && db.getCaseByNumber) {
        const caseData = await db.getCaseByNumber(number);
        if (caseData) {
            return `🔍 تم العثور على الحالة: ${caseData.name}\n📋 الحالة: ${caseData.status}\n💰 المبلغ: ${caseData.amount || caseData.monthly_amount || 0} جنيه`;
        }
    }
    
    // إذا لم نجد الحالة، نمرر السؤال إلى AI
    return null;
}

// تصدير الدوال
if (typeof module !== 'undefined') {
    module.exports = {
        isComplexQuestion,
        needsDatabase,
        askLocalAI,
        askRemoteAI,
        routeQuestion,
        handleDatabaseQuestion,
        COMPLEX_KEYWORDS,
        SIMPLE_KEYWORDS
    };
} else {
    window.AIRouter = {
        isComplexQuestion,
        needsDatabase,
        askLocalAI,
        askRemoteAI,
        routeQuestion,
        handleDatabaseQuestion,
        COMPLEX_KEYWORDS,
        SIMPLE_KEYWORDS
    };
}
