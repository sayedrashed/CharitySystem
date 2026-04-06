# =====================================================================
# core/ai/telegram_ai_bot.py
# المساعد الذكي - بوت تليجرام الرئيسي + AI (Qwen2.5)
# المرجع: PROJECT_CONTEXT.txt
# المهام:
# 1. استقبال رسائل الحالات (24-29 من كل شهر)
# 2. استخراج الاسم والرقم باستخدام AI
# 3. التحقق من حالة الحالة في قاعدة البيانات
# 4. الرد المناسب (قبول، موقوف، مرفوض)
# 5. تسجيل طلبات طباعة الظرف
# 6. ربط المشتركين ببوت التذكير
# 7. لا يوجد ردود ثابتة - كل شيء عبر AI
# =====================================================================

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

# أيام استقبال الطلبات
REQUEST_START_DAY = 24
REQUEST_END_DAY = 29

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
            branch TEXT,
            category TEXT,
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
        CREATE TABLE IF NOT EXISTS keeper_subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT UNIQUE,
            user_id TEXT,
            case_id TEXT,
            case_name TEXT,
            case_serial TEXT,
            subscribed_at TEXT,
            is_active INTEGER DEFAULT 1
        )
    ''')
    
    # إضافة بعض البيانات التجريبية للحالات (للتجربة)
    cursor.execute("SELECT COUNT(*) FROM cases")
    if cursor.fetchone()[0] == 0:
        sample_cases = [
            ('CASE001', 'أحمد محمود', '571', '101', 'مقبولة', 500, 500, 'شبرا', 'شبرا', 1),
            ('CASE002', 'سارة علي', '572', '102', 'مقبولة', 500, 500, 'شبرا', 'شبرا', 1),
            ('CASE003', 'محمود خالد', '573', '103', 'موقوفة', 500, 500, 'شبرا', 'شبرا', 1),
            ('CASE004', 'فاطمة حسن', '574', '104', 'مقبولة', 500, 500, 'النهضة', 'النهضة', 1),
            ('CASE005', 'علي إبراهيم', '575', '105', 'معلقة', 500, 500, 'النهضة', 'النهضة', 1),
        ]
        for case in sample_cases:
            cursor.execute('''
                INSERT INTO cases (id, name, serial_global, serial_accounting, status, amount, monthly_amount, branch, category, has_smartphone, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (case[0], case[1], case[2], case[3], case[4], case[5], case[6], case[7], case[8], case[9], datetime.now().isoformat(), datetime.now().isoformat()))
    
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
    greetings = ['السلام عليكم', 'وعليكم السلام', 'صباح الخير', 'مساء الخير', 'تحياتي', 'يا']
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
    print(f"✅ تم تسجيل طلب ظرف للحالة {case_data['name']}")

def add_keeper_subscriber(chat_id: str, user_id: str, case_id: str, case_name: str, case_serial: str):
    """تسجيل المشترك في بوت التذكير"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    cursor.execute('SELECT * FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    existing = cursor.fetchone()
    
    if existing:
        cursor.execute('''
            UPDATE keeper_subscribers 
            SET is_active = 1, case_name = ?, case_serial = ?, subscribed_at = ?
            WHERE chat_id = ?
        ''', (case_name, case_serial, now, chat_id))
    else:
        cursor.execute('''
            INSERT INTO keeper_subscribers (chat_id, user_id, case_id, case_name, case_serial, subscribed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (chat_id, user_id, case_id, case_name, case_serial, now))
    
    conn.commit()
    conn.close()
    print(f"✅ تم تسجيل {case_name} في خدمة التذكير")

def is_request_period() -> bool:
    """التحقق مما إذا كان اليوم ضمن فترة استقبال الطلبات (24-29)"""
    day = datetime.now().day
    return REQUEST_START_DAY <= day <= REQUEST_END_DAY

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
    prompt = f'''استخرج اسم الحالة ورقمها من هذه الرسالة: "{message}"
أعد JSON فقط بهذا الشكل:
{{"name": "الاسم المستخرج", "number": "الرقم المستخرج"}}
إذا لم تجد اسماً فاجعل name: null، وإذا لم تجد رقماً فاجعل number: null'''
    
    response = await ask_ai(prompt)
    try:
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except:
        pass
    
    # الطريقة التقليدية (بدون AI)
    numbers = re.findall(r'\d+', message)
    number = numbers[0] if numbers else None
    name = re.sub(r'\d+', '', message)
    name = clean_name(name)
    return {"name": name if name else None, "number": number}

async def generate_reply(case_data: Dict, is_request_period: bool) -> str:
    if not case_data:
        return "❌ الحالة غير موجودة في قاعدة البيانات. يرجى التأكد من الاسم أو الرقم والتواصل مع الباحث."
    
    status = case_data.get('status', '')
    name = case_data.get('name', '')
    number = case_data.get('serial_global', '')
    branch = case_data.get('branch', '')
    amount = case_data.get('amount', 0)
    
    if status == 'مقبولة':
        if is_request_period:
            return f"✅ مرحباً {name}، تم استلام طلبك بنجاح.\n📍 سيتم تجهيز قبضك (المبلغ: {amount} جنيه).\n🖨️ يرجى متابعة الإشعارات لمعرفة موعد الاستلام."
        else:
            return f"✅ حالتك {name} (م.ع {number}) مقبولة.\n📅 مواعيد الصرف: فرع شبرا (1-7)، فرع النهضة (1-4).\n📞 للاستفسار: 01111878692"
    
    elif status == 'موقوفة':
        return f"⚠️ الحالة {name} (م.ع {number}) موقوفة حالياً.\n📞 يرجى التواصل مع الباحث على رقم الجمعية: 01111878692"
    
    elif status == 'معلقة':
        return f"⚠️ الحالة {name} (م.ع {number}) معلقة حالياً.\n📞 يرجى التواصل مع الباحث على رقم الجمعية: 01111878692"
    
    elif status == 'ملغاة' or status == 'مرفوضة':
        return f"❌ الحالة {name} (م.ع {number}) ملغاة، لا يمكن صرف مساعدة.\n📞 للاستفسار: 01111878692"
    
    else:
        return f"❓ الحالة {name} (م.ع {number}) حالتها: {status}.\n📞 يرجى التواصل مع الباحث لمزيد من المعلومات."

# ============================================================
# معالجة الرسائل
# ============================================================

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user:
        return
    
