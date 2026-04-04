// core/api/ai_routes.js
// API Routes للذكاء الاصطناعي - ربط Node.js مع بوت Python

const express = require('express');
const router = express.Router();

// ============================================================
// تكوين الاتصال بـ Ollama
// ============================================================

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const AI_MODEL = process.env.AI_MODEL || 'qwen2.5:7b';

/**
 * إرسال طلب إلى Ollama
 */
async function askOllama(prompt, options = {}) {
    const { temperature = 0.7, maxTokens = 500 } = options;
    
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: AI_MODEL,
                prompt: prompt,
                stream: false,
                temperature: temperature,
                max_tokens: maxTokens
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return data.response || '';
    } catch (error) {
        console.error('[AI Routes] خطأ في Ollama:', error);
        return '';
    }
}

// ============================================================
// API Endpoints
// ============================================================

/**
 * POST /api/ai/ask
 * سؤال عام للذكاء الاصطناعي
 */
router.post('/ask', async (req, res) => {
    const { question, context } = req.body;
    
    if (!question) {
        return res.status(400).json({ error: 'السؤال مطلوب' });
    }
    
    try {
        const answer = await askOllama(question);
        res.json({ answer, source: 'ollama', model: AI_MODEL });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ai/telegram
 * معالجة رسائل التليجرام (يستخدمه بوت Python)
 */
router.post('/telegram', async (req, res) => {
    const { message, user_id, chat_id } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'الرسالة مطلوبة' });
    }
    
    const prompt = `
    أنت مساعد ذكي لإدارة الحالات في جمعية خيرية.
    
    المهمة: فهم رسالة الحالة واستخراج المعلومات.
    
    الرسالة: "${message}"
    
    قم بتحليل الرسالة واستخرج:
    1. الاسم الكامل للحالة (إن وجد)
    2. الرقم (م.ع أو م.م) (إن وجد)
    
    أعد الإجابة بصيغة JSON فقط:
    {"name": "الاسم أو null", "number": "الرقم أو null"}
    `;
    
    try {
        const aiResponse = await askOllama(prompt, { temperature: 0.3, maxTokens: 150 });
        
        // محاولة استخراج JSON من الرد
        let extracted = { name: null, number: null };
        try {
            const jsonMatch = aiResponse.match(/\{.*\}/s);
            if (jsonMatch) {
                extracted = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {}
        
        res.json({
            success: true,
            extracted: {
                name: extracted.name === 'null' ? null : extracted.name,
                number: extracted.number === 'null' ? null : extracted.number
            },
            raw_response: aiResponse
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ai/analyze
 * تحليل بيانات الحالة وتقديم تقرير ذكي
 */
router.post('/analyze', async (req, res) => {
    const { caseData } = req.body;
    
    if (!caseData) {
        return res.status(400).json({ error: 'بيانات الحالة مطلوبة' });
    }
    
    const prompt = `
    أنت محلل اجتماعي خبير في العمل الخيري.
    
    بناءً على بيانات الحالة التالية، قدم:
    1. تحليل موجز للوضع
    2. نقاط القوة (إن وجدت)
    3. نقاط الضعف والتحديات
    4. توصيات مقترحة
    
    بيانات الحالة:
    - الاسم: ${caseData.name || 'غير محدد'}
    - الرقم: ${caseData.serial_global || caseData.serial_accounting || 'غير محدد'}
    - الحالة: ${caseData.status || 'غير محدد'}
    - المبلغ الشهري: ${caseData.monthly_amount || 0} جنيه
    - عدد أفراد الأسرة: ${caseData.family_size || 'غير محدد'}
    
    التقرير:
    `;
    
    try {
        const analysis = await askOllama(prompt, { temperature: 0.5, maxTokens: 500 });
        res.json({ analysis });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ai/summarize
 * تلخيص تقرير طويل
 */
router.post('/summarize', async (req, res) => {
    const { text, maxLength = 200 } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'النص مطلوب' });
    }
    
    const prompt = `
    لخص النص التالي في ${maxLength} حرف كحد أقصى، مع الحفاظ على المعلومات الأساسية:
    
    "${text}"
    
    التلخيص:
    `;
    
    try {
        const summary = await askOllama(prompt, { temperature: 0.3, maxTokens: 300 });
        res.json({ summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/ai/extract
 * استخراج بيانات من نص حر (مثل وصف الحالة)
 */
router.post('/extract', async (req, res) => {
    const { text, fields } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'النص مطلوب' });
    }
    
    const fieldsList = fields || ['name', 'phone', 'address', 'income', 'family_count'];
    
    const prompt = `
    استخرج البيانات التالية من النص: ${fieldsList.join(', ')}
    
    النص: "${text}"
    
    أعد JSON فقط:
    {
        ${fieldsList.map(f => `"${f}": "القيمة أو null"`).join(',\n        ')}
    }
    `;
    
    try {
        const result = await askOllama(prompt, { temperature: 0.2, maxTokens: 300 });
        
        let extracted = {};
        try {
            const jsonMatch = result.match(/\{.*\}/s);
            if (jsonMatch) {
                extracted = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {}
        
        res.json({ extracted });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/ai/status
 * التحقق من حالة خادم الذكاء الاصطناعي
 */
router.get('/status', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        if (response.ok) {
            const data = await response.json();
            res.json({
                status: 'online',
                models: data.models || [],
                ollama_url: OLLAMA_URL
            });
        } else {
            res.json({ status: 'offline', error: 'Ollama غير متاح' });
        }
    } catch (error) {
        res.json({ status: 'offline', error: error.message });
    }
});

module.exports = router;
