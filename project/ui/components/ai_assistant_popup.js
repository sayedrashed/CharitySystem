// ui/components/ai_assistant_popup.js
// نافذة المساعد الذكي المنبثقة

class AIAssistantPopup {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.isLoading = false;
        this.createPopup();
        this.addStyles();
        this.setupEventListeners();
    }

    createPopup() {
        // إنشاء النافذة المنبثقة
        const popup = document.createElement('div');
        popup.id = 'ai-assistant-popup';
        popup.className = 'ai-popup';
        popup.innerHTML = `
            <div class="ai-popup-header">
                <div class="ai-popup-title">
                    <span class="ai-icon">🧠</span>
                    <span>المساعد الذكي</span>
                </div>
                <div class="ai-popup-actions">
                    <button class="ai-minimize-btn">−</button>
                    <button class="ai-close-btn">✕</button>
                </div>
            </div>
            <div class="ai-popup-body">
                <div class="ai-messages-container" id="aiMessagesContainer">
                    <div class="ai-message ai-message-bot">
                        <div class="ai-message-avatar">🤖</div>
                        <div class="ai-message-content">
                            مرحباً! أنا المساعد الذكي. كيف يمكنني مساعدتك اليوم؟
                        </div>
                    </div>
                </div>
                <div class="ai-typing-indicator" id="aiTypingIndicator" style="display:none;">
                    <span>🧠</span>
                    <span>يكتب...</span>
                </div>
            </div>
            <div class="ai-popup-footer">
                <input type="text" id="aiMessageInput" class="ai-message-input" placeholder="اكتب سؤالك هنا...">
                <button class="ai-send-btn" id="aiSendBtn">📤</button>
            </div>
        `;
        document.body.appendChild(popup);
        
        // حفظ المراجع
        this.popup = popup;
        this.messagesContainer = document.getElementById('aiMessagesContainer');
        this.typingIndicator = document.getElementById('aiTypingIndicator');
        this.messageInput = document.getElementById('aiMessageInput');
        this.sendBtn = document.getElementById('aiSendBtn');
        this.minimizeBtn = popup.querySelector('.ai-minimize-btn');
        this.closeBtn = popup.querySelector('.ai-close-btn');
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .ai-popup {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 350px;
                height: 450px;
                background: var(--bg-secondary, #1A1D27);
                border: 1px solid var(--border, #2E3250);
                border-radius: 16px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                display: flex;
                flex-direction: column;
                z-index: 10000;
                font-family: 'Segoe UI', 'Tahoma', 'Cairo', sans-serif;
                direction: rtl;
                transition: all 0.3s ease;
            }
            
            .ai-popup.minimized {
                height: 50px;
                overflow: hidden;
            }
            
            .ai-popup-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: linear-gradient(135deg, var(--accent, #4F8EF7), var(--success, #2DD4BF));
                border-radius: 16px 16px 0 0;
                cursor: move;
            }
            
            .ai-popup-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: bold;
                color: white;
            }
            
            .ai-icon {
                font-size: 20px;
            }
            
            .ai-popup-actions {
                display: flex;
                gap: 8px;
            }
            
            .ai-popup-actions button {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 16px;
                padding: 0 4px;
            }
            
            .ai-popup-body {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
                display: flex;
                flex-direction: column;
            }
            
            .ai-messages-container {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .ai-message {
                display: flex;
                gap: 10px;
                animation: aiMessageFadeIn 0.3s ease;
            }
            
            @keyframes aiMessageFadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .ai-message-user {
                flex-direction: row-reverse;
            }
            
            .ai-message-avatar {
                width: 32px;
                height: 32px;
                background: var(--accent, #4F8EF7);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                flex-shrink: 0;
            }
            
            .ai-message-user .ai-message-avatar {
                background: var(--success, #2DD4BF);
            }
            
            .ai-message-content {
                max-width: 70%;
                padding: 8px 12px;
                background: var(--bg-primary, #0F1117);
                border-radius: 12px;
                font-size: 13px;
                line-height: 1.5;
            }
            
            .ai-message-user .ai-message-content {
                background: var(--accent, #4F8EF7);
                color: white;
            }
            
            .ai-typing-indicator {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--bg-primary, #0F1117);
                border-radius: 12px;
                width: fit-content;
                font-size: 12px;
                color: var(--text-secondary, #6B7280);
                animation: aiTypingPulse 1s infinite;
            }
            
            @keyframes aiTypingPulse {
                0%, 100% { opacity: 0.5; }
                50% { opacity: 1; }
            }
            
            .ai-popup-footer {
                display: flex;
                gap: 8px;
                padding: 12px;
                border-top: 1px solid var(--border, #2E3250);
            }
            
            .ai-message-input {
                flex: 1;
                padding: 8px 12px;
                background: var(--bg-primary, #0F1117);
                border: 1px solid var(--border, #2E3250);
                border-radius: 20px;
                color: var(--text-primary, #E8EBF4);
                font-size: 13px;
                font-family: inherit;
            }
            
            .ai-message-input:focus {
                outline: none;
                border-color: var(--accent, #4F8EF7);
            }
            
            .ai-send-btn {
                background: var(--accent, #4F8EF7);
                border: none;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                cursor: pointer;
                font-size: 18px;
                transition: all 0.3s ease;
            }
            
            .ai-send-btn:hover {
                transform: scale(1.05);
                opacity: 0.9;
            }
            
            /* زر فتح المساعد (يظهر عند إغلاق النافذة) */
            .ai-open-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 56px;
                height: 56px;
                background: linear-gradient(135deg, var(--accent, #4F8EF7), var(--success, #2DD4BF));
                border: none;
                border-radius: 50%;
                cursor: pointer;
                font-size: 28px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 9999;
                transition: all 0.3s ease;
                display: none;
            }
            
            .ai-open-btn:hover {
                transform: scale(1.1);
            }
            
            @media (max-width: 500px) {
                .ai-popup {
                    width: calc(100% - 40px);
                    right: 20px;
                    left: 20px;
                    height: 70vh;
                }
            }
        `;
        document.head.appendChild(style);
        
        // زر الفتح
        const openBtn = document.createElement('button');
        openBtn.id = 'aiOpenBtn';
        openBtn.className = 'ai-open-btn';
        openBtn.innerHTML = '🧠';
        openBtn.onclick = () => this.open();
        document.body.appendChild(openBtn);
        this.openBtn = openBtn;
    }

    setupEventListeners() {
        this.sendBtn.onclick = () => this.sendMessage();
        this.messageInput.onkeypress = (e) => {
            if (e.key === 'Enter') this.sendMessage();
        };
        this.minimizeBtn.onclick = () => this.minimize();
        this.closeBtn.onclick = () => this.close();
        
        // سحب النافذة
        let isDragging = false;
        let dragStartX, dragStartY, popupStartX, popupStartY;
        
        const header = this.popup.querySelector('.ai-popup-header');
        header.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            popupStartX = this.popup.offsetLeft;
            popupStartY = this.popup.offsetTop;
            this.popup.style.position = 'fixed';
            this.popup.style.cursor = 'grabbing';
        };
        
        document.onmousemove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            this.popup.style.left = `${popupStartX + dx}px`;
            this.popup.style.top = `${popupStartY + dy}px`;
            this.popup.style.right = 'auto';
            this.popup.style.bottom = 'auto';
        };
        
        document.onmouseup = () => {
            isDragging = false;
            this.popup.style.cursor = '';
        };
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isLoading) return;
        
        // إضافة رسالة المستخدم
        this.addMessage(message, 'user');
        this.messageInput.value = '';
        this.isLoading = true;
        this.showTyping();
        
        try {
            // إرسال إلى AI
            const response = await this.askAI(message);
            this.hideTyping();
            this.addMessage(response, 'bot');
        } catch (error) {
            this.hideTyping();
            this.addMessage('عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.', 'bot');
            console.error(error);
        }
        
        this.isLoading = false;
        this.scrollToBottom();
    }

    addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `ai-message ai-message-${sender}`;
        messageDiv.innerHTML = `
            <div class="ai-message-avatar">${sender === 'user' ? '👤' : '🤖'}</div>
            <div class="ai-message-content">${this.escapeHtml(text)}</div>
        `;
        this.messagesContainer.appendChild(messageDiv);
        this.messages.push({ text, sender, timestamp: new Date() });
        this.scrollToBottom();
    }

    async askAI(question) {
        // محاولة الاتصال بخادم AI المحلي
        try {
            const response = await fetch('http://localhost:3000/api/ai/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question })
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.answer || 'عذراً، لم أتمكن من الإجابة.';
            }
        } catch (error) {
            console.log('خادم AI غير متاح، استخدام ردود محلية');
        }
        
        // ردود محلية في حالة عدم توفر الخادم
        return this.getLocalResponse(question);
    }

    getLocalResponse(question) {
        const q = question.toLowerCase();
        
        if (q.includes('حالة') || q.includes('رقم')) {
            return 'يمكنك البحث عن الحالة من خلال إدارة الحالات. هل تحتاج مساعدة في البحث؟';
        }
        if (q.includes('زيارة') || q.includes('خطة')) {
            return 'يمكنك إنشاء خطط زيارات من خلال إدارة الزيارات. هل تريد إنشاء خطة جديدة؟';
        }
        if (q.includes('مرتب') || q.includes('راتب')) {
            return 'يمكنك عرض المرتبات من خلال قسم الموظفين. هل تحتاج مساعدة في حساب مرتب معين؟';
        }
        if (q.includes('مساعدة')) {
            return 'أنا هنا لمساعدتك! يمكنني مساعدتك في: إدارة الحالات، إنشاء خطط الزيارات، حساب المرتبات، والإجابة عن أسئلتك.';
        }
        return 'شكراً لسؤالك. كيف يمكنني مساعدتك بشكل أفضل؟ يمكنك سؤالي عن الحالات، الزيارات، المرتبات، أو أي شيء آخر في النظام.';
    }

    showTyping() {
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    }

    hideTyping() {
        this.typingIndicator.style.display = 'none';
    }

    scrollToBottom() {
        const body = this.popup.querySelector('.ai-popup-body');
        body.scrollTop = body.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    open() {
        this.popup.style.display = 'flex';
        this.openBtn.style.display = 'none';
        this.isOpen = true;
        this.popup.classList.remove('minimized');
    }

    close() {
        this.popup.style.display = 'none';
        this.openBtn.style.display = 'flex';
        this.isOpen = false;
    }

    minimize() {
        this.popup.classList.toggle('minimized');
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
}

// تهيئة المساعد عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    // انتظار قليلاً للتأكد من تحميل باقي العناصر
    setTimeout(() => {
        if (!window.aiAssistant) {
            window.aiAssistant = new AIAssistantPopup();
        }
    }, 500);
});
