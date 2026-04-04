# core/ai/telegram_ai_bot.py
# المساعد الذكي - بوت تليجرام + AI (Qwen2.5)

import asyncio
import json
import sqlite3
import re
import os
from datetime import datetime
from typing import Optional, Dict, Any
import requests

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# ============================================================
# الإعدادات (CONFIGURATION)
# ============================================================

BOT_TOKEN = '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk'
GROUP_CHAT_ID = -1001639560426
KEEPER_BOT_URL = "https://t.me/obko_reminder_bot?start=from_main_bot"

# خادم AI (Ollama - Qwen2.5)
AI_API_URL = "http://localhost:11434/api/generate"
AI_MODEL = "qwen2.5:7b"

# مسار قاعدة البيانات
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(BASE_DIR, 'data', 'local.db')

# ============================================================
# دوال قاعدة البيانات
# ============================================================

def init_database():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            name TEXT,
            serial_global TEXT,
            serial_accounting TEXT,
            status TEXT,
            amount REAL,
            monthly_amount REAL,
            has_smartphone INTEGER DEFAULT 1,
            created_at TEXT,
            updated_at TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS zarf_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            case_name TEXT,
            case_number TEXT,
            request_date TEXT,
            status TEXT DEFAULT 'pending',
            printed_date TEXT,
            chat_id TEXT,
            user_id TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS zarf_print_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            printed_at TEXT,
            printed_by TEXT,
            month TEXT,
            year INTEGER
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS zarf_counter (
            id INTEGER PRIMARY KEY,
            total_expected INTEGER DEFAULT 0,
            requested_count INTEGER DEFAULT 0,
            printed_count INTEGER DEFAULT 0,
            updated_at TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE,
            case_id TEXT,
            subscribed_at TEXT
        )
    ''')
    
    conn.commit()
    conn.close()
    print(f"✅ قاعدة البيانات جاهزة: {DB_PATH}")

def get_case_by_number(number: str) -> Optional[Dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM cases WHERE serial_global = ?', (number,))
    row = cursor.fetchone()
    if not row:
        cursor.execute('SELECT * FROM cases WHERE serial_accounting = ?', (number,))
        row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_case_by_name(name: str) -> Optional[Dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    name = clean_name(name)
    cursor.execute('SELECT * FROM cases WHERE name LIKE ?', (f'%{name}%',))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def clean_name(name: str) -> str:
    greetings = ['السلام عليكم', 'وعليكم السلام', 'صباح الخير', 'مساء الخير', 'تحياتي']
    for g in greetings:
        name = name.replace(g, '')
    name = name.replace('ة', 'ه').replace('ى', 'ي')
    name = re.sub(r'[^أ-ي\s]', '', name)
    return name.strip()

def save_zarf_request(case_data: Dict, chat_id: str, user_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute('''
        INSERT INTO zarf_requests (case_id, case_name, case_number, request_date, status, chat_id, user_id)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
    ''', (case_data['id'], case_data['name'], case_data['serial_global'], now, chat_id, user_id))
    cursor.execute('''
        INSERT INTO zarf_counter (id, total_expected, requested_count, updated_at)
        VALUES (1, COALESCE((SELECT total_expected FROM zarf_counter WHERE id=1), 0),
                COALESCE((SELECT requested_count FROM zarf_counter WHERE id=1), 0) + 1, ?)
        ON CONFLICT(id) DO UPDATE SET requested_count = requested_count + 1, updated_at = excluded.updated_at
    ''', (now,))
    conn.commit()
    conn.close()

# ============================================================
# دوال الذكاء الاصطناعي
# ============================================================

async def ask_ai(prompt: str) -> str:
    try:
        response = requests.post(AI_API_URL, json={
            "model": AI_MODEL,
            "prompt": prompt,
            "stream": False,
            "temperature": 0.7,
            "max_tokens": 500
        }, timeout=30)
        if response.status_code == 200:
            return response.json().get('response', '')
    except Exception as e:
        print(f"❌ خطأ في AI: {e}")
    return ""

async def extract_info_with_ai(message: str) -> Dict[str, Any]:
    prompt = f'استخرج اسم الحالة ورقمها من هذه الرسالة: "{message}" أعد JSON فقط: {{"name": "الاسم", "number": "الرقم"}}'
    response = await ask_ai(prompt)
    try:
        import json
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except:
        pass
    numbers = re.findall(r'\d+', message)
    number = numbers[0] if numbers else None
    name = re.sub(r'\d+', '', message)
    name = clean_name(name)
    return {"name": name if name else None, "number": number}

async def generate_reply(case_data: Dict) -> str:
    if not case_data:
        return "❌ الحالة غير موجودة في قاعدة البيانات"
    status = case_data.get('status', '')
    name = case_data.get('name', '')
    number = case_data.get('serial_global', '')
    amount = case_data.get('amount', 0)
    if status == 'مقبولة':
        return f"✅ تم تجهيز قبضك للحالة: {name} (م.ع {number})\n📍 المبلغ: {amount} جنيه\n🖨️ يرجى التوجه لاستلامه من مكتب الصرف"
    elif status == 'موقوفة':
        return f"⚠️ الحالة {name} موقوفة حالياً، يرجى التواصل مع الباحث"
    elif status == 'معلقة':
        return f"⚠️ الحالة {name} معلقة حالياً، يرجى التواصل مع الباحث"
    elif status == 'ملغاة':
        return f"⚠️ الحالة {name} ملغاة، لا يمكن صرف مساعدة"
    else:
        return f"❓ الحالة {name} غير مقبولة حالياً (الحالة: {status})"

# ============================================================
# معالجة الرسائل
# ============================================================

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user:
        return
    user_id = str(update.message.from_user.id)
    chat_id = str(update.message.chat_id)
    message_text = update.message.text.strip()
    if message_text.startswith('/'):
        return
    await update.message.reply_text("⏳ جاري تجهيز قبضك... انتظر قليلاً")
    extracted = await extract_info_with_ai(message_text)
    case_data = None
    if extracted.get('number'):
        case_data = get_case_by_number(extracted['number'])
    if not case_data and extracted.get('name'):
        case_data = get_case_by_name(extracted['name'])
    reply = await generate_reply(case_data)
    if case_data and case_data.get('status') == 'مقبولة':
        save_zarf_request(case_data, chat_id, user_id)
        keyboard = [[InlineKeyboardButton("🔔 اشتراك في التذكير", url=KEEPER_BOT_URL)]]
        await update.message.reply_text(
            f"{reply}\n\n🖨️ اضغط اشتراك ثم ابدأ لاستلام تذكير بمواعيد الصرف",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    else:
        await update.message.reply_text(reply)

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query:
        return
    await query.answer()
    if query.data == "show_payment_date":
        await query.answer(text="🗓️ شبرا: 1/7 - 7/7\n🕌 النهضة: 1/7 - 4/7\n📞 01111878692", show_alert=True)

# ============================================================
# التشغيل
# ============================================================

def main():
    init_database()
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler('start', handle_message))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(CallbackQueryHandler(handle_callback))
    print("✅ بوت المساعد الذكي (AI Assistant) يعمل...")
    app.run_polling()

if __name__ == '__main__':
    main()
