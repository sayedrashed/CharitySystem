# core/ai/keeper_bot.py
# بوت التذكير (Keeper Bot)
# يرسل تذكيرات يومية للحالات المسجلة

import asyncio
import sqlite3
import os
from datetime import datetime
from telegram import Bot
import schedule
import time

# ============================================================
# الإعدادات
# ============================================================

# توكن بوت التذكير (الخاص بك)
KEEPER_BOT_TOKEN = '7443426622:AAFbPKjJ0fSweZxHxpglopgdg6hyWkLJgs8'

# معرف الجروب (نفس الجروب)
GROUP_CHAT_ID = -1001639560426

# معرف المدير (للإشعارات)
ADMIN_ID = 2130979393

# مسار قاعدة البيانات
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(BASE_DIR, 'data', 'local.db')

# مسار ملف Excel (للحفاظ على التوافق مع الكود القديم)
EXCEL_FILE = os.path.join(BASE_DIR, 'data', 'registered_users.xlsx')

# رسالة التذكير اليومية
REMINDER_MESSAGE = """
🔔 تذكير هام 🔔

📅 مواعيد الصرف لهذا الشهر:

📍 فرع شبرا والمعاقين: من يوم 1 إلى يوم 7 من كل شهر
📍 فرع النهضة والشركة: من يوم 1 إلى يوم 4 من كل شهر

📋 يرجى التوجه إلى مكتب الصرف في المواعيد المحددة.
🆔 لا تنسى إحضار بطاقة الرقم القومي.

📞 للاستفسار: 01111878692
"""

# رسالة ترحيب للمستخدم الجديد
WELCOME_MESSAGE = """
👋 أهلًا بك في خدمة التذكير الآلي!

✅ تم تسجيلك بنجاح.
📅 ستتلقى تذكيرات يومية بمواعيد الصرف.

لإلغاء الاشتراك، أرسل /unsubscribe
"""

# ============================================================
# دوال قاعدة البيانات
# ============================================================

def init_database():
    """إنشاء جدول المشتركين إذا لم يكن موجوداً"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS keeper_subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT UNIQUE,
            user_id TEXT,
            case_id TEXT,
            case_name TEXT,
            subscribed_at TEXT,
            last_reminder TEXT
        )
    ''')
    
    conn.commit()
    conn.close()
    print(f"✅ قاعدة البيانات جاهزة: {DB_PATH}")

def get_all_subscribers():
    """الحصول على جميع المشتركين"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT chat_id, user_id, case_id, case_name FROM keeper_subscribers')
    subscribers = cursor.fetchall()
    conn.close()
    return subscribers

def update_last_reminder(chat_id):
    """تحديث تاريخ آخر تذكير"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE keeper_subscribers 
        SET last_reminder = ? 
        WHERE chat_id = ?
    ''', (datetime.now().isoformat(), chat_id))
    conn.commit()
    conn.close()

def add_subscriber(chat_id, user_id, case_id, case_name):
    """إضافة مشترك جديد"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    # التحقق من عدم وجوده مسبقاً
    cursor.execute('SELECT * FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    existing = cursor.fetchone()
    
    if existing:
        print(f"ℹ️ المستخدم {chat_id} مسجل مسبقاً")
        conn.close()
        return False
    
    cursor.execute('''
        INSERT INTO keeper_subscribers (chat_id, user_id, case_id, case_name, subscribed_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (chat_id, user_id, case_id, case_name, now))
    conn.commit()
    conn.close()
    print(f"✅ تم تسجيل {case_name} (ID: {case_id}) في خدمة التذكير")
    return True

def remove_subscriber(chat_id):
    """إلغاء اشتراك مستخدم"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT case_name FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    subscriber = cursor.fetchone()
    
    cursor.execute('DELETE FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    conn.commit()
    conn.close()
    
    if subscriber:
        print(f"✅ تم إلغاء اشتراك {subscriber[0]} (Chat ID: {chat_id})")
    return True

def is_subscribed(chat_id):
    """التحقق من اشتراك المستخدم"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    result = cursor.fetchone()
    conn.close()
    return result is not None

# ============================================================
# دوال البوت
# ============================================================

async def send_reminder():
    """إرسال التذكير إلى جميع المشتركين"""
    bot = Bot(token=KEEPER_BOT_TOKEN)
    subscribers = get_all_subscribers()
    
    if not subscribers:
        print("📭 لا يوجد مشتركين حالياً")
        return
    
    success_count = 0
    error_count = 0
    
    for chat_id, user_id, case_id, case_name in subscribers:
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=REMINDER_MESSAGE,
                parse_mode='HTML'
            )
            update_last_reminder(chat_id)
            success_count += 1
            print(f"✅ تم إرسال تذكير إلى {case_name} ({chat_id})")
        except Exception as e:
            error_count += 1
            print(f"❌ فشل إرسال تذكير إلى {chat_id}: {e}")
    
    # إرسال تقرير للمدير
    try:
        report = f"📊 تقرير التذكير اليومي:\n✅ نجاح: {success_count}\n❌ فشل: {error_count}"
        await bot.send_message(chat_id=ADMIN_ID, text=report)
    except:
        pass
    
    print(f"📊 ملخص التذكير: نجاح {success_count} / فشل {error_count}")

async def send_welcome(chat_id, case_name):
    """إرسال رسالة ترحيب للمستخدم الجديد"""
    bot = Bot(token=KEEPER_BOT_TOKEN)
    try:
        await bot.send_message(
            chat_id=chat_id,
            text=f"👋 مرحباً {case_name}!\n\n{WELCOME_MESSAGE}",
            parse_mode='HTML'
        )
    except Exception as e:
        print(f"❌ فشل إرسال ترحيب إلى {chat_id}: {e}")

async def send_unsubscribe_confirmation(chat_id, case_name):
    """إرسال تأكيد إلغاء الاشتراك"""
    bot = Bot(token=KEEPER_BOT_TOKEN)
    try:
        await bot.send_message(
            chat_id=chat_id,
            text=f"✅ تم إلغاء اشتراكك بنجاح {case_name}.\n\nلن تصلك تذكيرات بعد الآن.\nلإعادة الاشتراك، تواصل مع الباحث.",
            parse_mode='HTML'
        )
    except Exception as e:
        print(f"❌ فشل إرسال تأكيد إلى {chat_id}: {e}")

def run_reminder():
    """تشغيل التذكير (للاستخدام مع schedule)"""
    asyncio.run(send_reminder())

# ============================================================
# دوال للربط مع البوت الرئيسي (API)
# ============================================================

def subscribe_user(chat_id, user_id, case_id, case_name):
    """تسجيل مستخدم في خدمة التذكير (يُستدعى من البوت الرئيسي)"""
    success = add_subscriber(chat_id, user_id, case_id, case_name)
    if success:
        # إرسال رسالة ترحيب
        asyncio.run(send_welcome(chat_id, case_name))
    return success

def unsubscribe_user(chat_id):
    """إلغاء اشتراك مستخدم"""
    # الحصول على اسم الحالة قبل الحذف
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT case_name FROM keeper_subscribers WHERE chat_id = ?', (chat_id,))
    result = cursor.fetchone()
    case_name = result[0] if result else 'المستخدم'
    conn.close()
    
    removed = remove_subscriber(chat_id)
    if removed:
        asyncio.run(send_unsubscribe_confirmation(chat_id, case_name))
    return removed

def get_subscribers_count():
    """الحصول على عدد المشتركين"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM keeper_subscribers')
    count = cursor.fetchone()[0]
    conn.close()
    return count

# ============================================================
# تشغيل البوت (للاختبار المباشر)
# ============================================================

def main():
    """تشغيل بوت التذكير"""
    init_database()
    
    # جدولة التذكير: كل يوم في الساعة 1 ظهراً
    schedule.every().day.at("13:00").do(run_reminder)
    
    print("=" * 50)
    print("✅ بوت التذكير (Keeper Bot) يعمل...")
    print(f"🤖 التوكن: {KEEPER_BOT_TOKEN[:10]}...")
    print(f"👑 معرف المدير: {ADMIN_ID}")
    print(f"⏰ سيتم إرسال التذكير يومياً الساعة 1 ظهراً")
    print(f"📋 عدد المشتركين الحالي: {get_subscribers_count()}")
    print("=" * 50)
    
    # التشغيل المستمر
    while True:
        schedule.run_pending()
        time.sleep(60)  # التحقق كل دقيقة

if __name__ == '__main__':
    main()
