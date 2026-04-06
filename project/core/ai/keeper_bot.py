# =====================================================================
# core/ai/keeper_bot.py
# بوت التذكير (Keeper Bot) - النسخة النهائية
# المرجع: PROJECT_CONTEXT.txt
# المهام:
# 1. إرسال تذكيرات يومية للحالات المسجلة
# 2. تذكير بمواعيد الإرسال (24-29 من كل شهر)
# 3. تذكير بمواعيد القبض (فرع شبرا 1-7، فرع النهضة 1-4)
# 4. لا يوجد خيار إلغاء اشتراك
# 5. أي عذر يكون قبل مواعيد الإرسال
# =====================================================================

import asyncio
import sqlite3
import os
import schedule
import time
import threading
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

from telegram import Bot, Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler, ContextTypes
)

# ============================================================
# الإعدادات (CONFIGURATION)
# ============================================================

KEEPER_BOT_TOKEN = '7443426622:AAFbPKjJ0fSweZxHxpglopgdg6hyWkLJgs8'
ADMIN_ID = 2130979393

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(BASE_DIR, 'data', 'local.db')

MAIN_BOT_URL = "https://t.me/CharitySystemBot"

# أيام التذكير
REMINDER_DAYS_BEFORE_SEND = 7      # التذكير بمواعيد الإرسال يبدأ قبل 7 أيام (أي يوم 17)
SEND_START_DAY = 24                  # بداية فترة الإرسال
SEND_END_DAY = 29                    # نهاية فترة الإرسال

# مواعيد القبض
PAYMENT_SHOBRA_START = 1
PAYMENT_SHOBRA_END = 7
PAYMENT_NAHDA_START = 1
PAYMENT_NAHDA_END = 4

# وقت إرسال التذكير (الساعة 1 ظهراً)
REMINDER_HOUR = 13
REMINDER_MINUTE = 0

# ============================================================
# رسائل التذكير (بدون خيار إلغاء اشتراك)
# ============================================================

REMINDER_SEND_MESSAGE = """
📢 **تذكير بموعد إرسال طلب القبض** 📢

🗓️ فترة إرسال طلبات القبض: من يوم **{send_start}** إلى يوم **{send_end}** من كل شهر.

📱 يرجى إرسال رسالة تحتوي على:
• اسمك الكامل
• رقمك (م.ع أو م.م)

إلى البوت الرئيسي: [🤖 اضغط هنا]({main_bot_url})

📌 مثال: أحمد محمد 571

✅ بعد إرسال الرسالة، سيتم تجهيز قبضك تلقائياً.

⚠️ **تنبيه:** لا يجوز إرسال شخص بديل. أي عذر لديك يجب تقديمه قبل مواعيد الإرسال (قبل يوم 24).

📞 للاستفسار: 01111878692
"""

REMINDER_PAYMENT_MESSAGE = """
💰 **تذكير بموعد صرف القبض** 💰

📅 مواعيد الصرف لهذا الشهر:

📍 **فرع شبرا:** من يوم **{shobra_start}** إلى يوم **{shobra_end}** من كل شهر
📍 **فرع النهضة:** من يوم **{nahda_start}** إلى يوم **{nahda_end}** من كل شهر

📋 يرجى التوجه إلى مكتب الصرف في المواعيد المحددة.
🆔 لا تنسى إحضار **الكارنيه والختم**.

⚠️ **تنبيه:** لا يجوز إرسال شخص بديل. الحضور شخصياً إلزامي.

📞 للاستفسار: 01111878692
"""

WELCOME_MESSAGE = """
👋 أهلًا بك في خدمة التذكير الآلي!

✅ تم تسجيلك بنجاح.

📅 ستتلقى تذكيرات بـ:
1️⃣ **تذكير بمواعيد الإرسال** (قبل فترة الإرسال بأسبوع)
2️⃣ **تذكير بمواعيد الصرف** (قبل فترة الصرف بأسبوع)

🗓️ فترة الإرسال: من يوم 24 إلى 29 من كل شهر
🗓️ فترة الصرف: فرع شبرا (1-7)، فرع النهضة (1-4)

⚠️ **تنبيهات هامة:**
• لا يجوز إرسال شخص بديل
• أي عذر لديك يجب تقديمه قبل مواعيد الإرسال (قبل يوم 24)
• يجب إحضار الكارنيه والختم عند الصرف

🔗 للاستعلام المباشر عن قبضك، استخدم البوت الرئيسي: {main_bot_url}
"""

# ============================================================
# دوال قاعدة البيانات
# ============================================================

def init_database():
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
            case_serial TEXT,
            phone TEXT,
            subscribed_at TEXT,
            last_send_reminder TEXT,
            last_payment_reminder TEXT,
            reminder_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reminder_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT,
            case_id TEXT,
            sent_at TEXT,
            reminder_type TEXT,
            status TEXT
        )
    ''')
    
    # جدول الأعذار (تسجيل الأعذار قبل مواعيد الإرسال)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS excuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            case_name TEXT,
            excuse_text TEXT,
            submitted_at TEXT,
            approved INTEGER DEFAULT 0,
            approved_by TEXT,
            notes TEXT
        )
    ''')
    
    conn.commit()
    conn.close()
    print(f"✅ قاعدة بيانات بوت التذكير جاهزة: {DB_PATH}")

def get_all_subscribers() -> List[Dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT chat_id, user_id, case_id, case_name, case_serial, 
               subscribed_at, last_send_reminder, last_payment_reminder
        FROM keeper_subscribers WHERE is_active = 1
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def add_subscriber(chat_id: str, user_id: str, case_id: str, 
                   case_name: str, case_serial: str = '') -> bool:
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
            INSERT INTO keeper_subscribers 
            (chat_id, user_id, case_id, case_name, case_serial, subscribed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (chat_id, user_id, case_id, case_name, case_serial, now))
    
    conn.commit()
    conn.close()
    return True

def update_reminder_sent(chat_id: str, reminder_type: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    if reminder_type == 'send':
        cursor.execute('''
            UPDATE keeper_subscribers SET last_send_reminder = ?, reminder_count = reminder_count + 1
            WHERE chat_id = ?
        ''', (now, chat_id))
    elif reminder_type == 'payment':
        cursor.execute('''
            UPDATE keeper_subscribers SET last_payment_reminder = ?, reminder_count = reminder_count + 1
            WHERE chat_id = ?
        ''', (now, chat_id))
    
    conn.commit()
    conn.close()

def log_reminder(chat_id: str, case_id: str, reminder_type: str, status: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO reminder_log (chat_id, case_id, sent_at, reminder_type, status)
        VALUES (?, ?, ?, ?, ?)
    ''', (chat_id, case_id, datetime.now().isoformat(), reminder_type, status))
    conn.commit()
    conn.close()

def get_subscribers_count() -> int:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM keeper_subscribers WHERE is_active = 1')
    count = cursor.fetchone()[0]
    conn.close()
    return count

def add_excuse(case_id: str, case_name: str, excuse_text: str) -> bool:
    """تسجيل عذر (قبل مواعيد الإرسال فقط)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    day = datetime.now().day
    
    # التحقق: العذر يقبل فقط قبل يوم 24
    if day >= SEND_START_DAY:
        conn.close()
        return False
    
    cursor.execute('''
        INSERT INTO excuses (case_id, case_name, excuse_text, submitted_at)
        VALUES (?, ?, ?, ?)
    ''', (case_id, case_name, excuse_text, now))
    conn.commit()
    conn.close()
    return True

# ============================================================
# دوال إرسال التذكيرات
# ============================================================

def should_send_reminder(last_sent: Optional[str]) -> bool:
    if not last_sent:
        return True
    try:
        last_date = datetime.fromisoformat(last_sent).date()
        today = datetime.now().date()
        return last_date != today
    except:
        return True

async def send_send_reminder(bot: Bot, chat_id: str, case_name: str):
    """إرسال تذكير بمواعيد الإرسال (24-29)"""
    try:
        message = REMINDER_SEND_MESSAGE.format(
            send_start=SEND_START_DAY,
            send_end=SEND_END_DAY,
            main_bot_url=MAIN_BOT_URL
        )
        
        keyboard = InlineKeyboardMarkup([[
            InlineKeyboardButton("📱 إرسال طلب القبض الآن", url=MAIN_BOT_URL)
        ]])
        
        await bot.send_message(
            chat_id=chat_id,
            text=message,
            parse_mode='Markdown',
            reply_markup=keyboard
        )
        log_reminder(chat_id, case_name, 'send_reminder', 'sent')
        update_reminder_sent(chat_id, 'send')
        return True
    except Exception as e:
        print(f"❌ فشل إرسال تذكير إرسال إلى {chat_id}: {e}")
        log_reminder(chat_id, case_name, 'send_reminder', f'failed: {str(e)[:50]}')
        return False

async def send_payment_reminder(bot: Bot, chat_id: str, case_name: str):
    """إرسال تذكير بمواعيد القبض (فرع شبرا، فرع النهضة)"""
    try:
        message = REMINDER_PAYMENT_MESSAGE.format(
            shobra_start=PAYMENT_SHOBRA_START,
            shobra_end=PAYMENT_SHOBRA_END,
            nahda_start=PAYMENT_NAHDA_START,
            nahda_end=PAYMENT_NAHDA_END
        )
        
        await bot.send_message(
            chat_id=chat_id,
            text=message,
            parse_mode='Markdown'
        )
        log_reminder(chat_id, case_name, 'payment_reminder', 'sent')
        update_reminder_sent(chat_id, 'payment')
        return True
    except Exception as e:
        print(f"❌ فشل إرسال تذكير قبض إلى {chat_id}: {e}")
        log_reminder(chat_id, case_name, 'payment_reminder', f'failed: {str(e)[:50]}')
        return False

async def check_and_send_reminders():
    """التحقق من التاريخ وإرسال التذكيرات المناسبة"""
    bot = Bot(token=KEEPER_BOT_TOKEN)
    today = datetime.now()
    day_of_month = today.day
    
    subscribers = get_all_subscribers()
    if not subscribers:
        print("📭 لا يوجد مشتركين")
        return
    
    # تحديد نوع التذكير بناءً على التاريخ
    send_reminder_needed = False
    payment_reminder_needed = False
    
    # تذكير الإرسال: يبدأ قبل 7 أيام من 24 (أي يوم 17) ويستمر حتى يوم 29
    if REMINDER_DAYS_BEFORE_SEND <= day_of_month <= SEND_END_DAY:
        send_reminder_needed = True
    
    # تذكير القبض: يبدأ قبل 7 أيام من 1 (أي يوم 25 من الشهر السابق)
    # أو من 1 إلى 7 من الشهر الحالي
    if day_of_month >= 25 or day_of_month <= PAYMENT_SHOBRA_END:
        payment_reminder_needed = True
    
    success_send = 0
    success_payment = 0
    error_count = 0
    
    for sub in subscribers:
        chat_id = sub['chat_id']
        case_name = sub['case_name']
        
        if send_reminder_needed:
            last_sent = sub.get('last_send_reminder')
            if should_send_reminder(last_sent):
                if await send_send_reminder(bot, chat_id, case_name):
                    success_send += 1
                else:
                    error_count += 1
        
        if payment_reminder_needed:
            last_sent = sub.get('last_payment_reminder')
            if should_send_reminder(last_sent):
                if await send_payment_reminder(bot, chat_id, case_name):
                    success_payment += 1
                else:
                    error_count += 1
    
    # إرسال تقرير للمدير
    if success_send > 0 or success_payment > 0:
        try:
            report = f"📊 تقرير التذكيرات اليومي:\n"
            report += f"📨 تذكيرات الإرسال: {success_send}\n"
            report += f"💰 تذكيرات القبض: {success_payment}\n"
            report += f"❌ فشل: {error_count}\n"
            report += f"📋 إجمالي المشتركين: {get_subscribers_count()}"
            
            await bot.send_message(chat_id=ADMIN_ID, text=report)
        except Exception as e:
            print(f"❌ فشل إرسال التقرير للمدير: {e}")

# ============================================================
# معالجة الأوامر (بدون /unsubscribe)
# ============================================================

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user:
        return
    
    await update.message.reply_text(
        "👋 مرحباً بك في خدمة التذكير الآلي!\n\n"
        "للتسجيل، أرسل:\n"
        "/subscribe الاسم رقم الحالة\n\n"
        "مثال:\n"
        "/subscribe أحمد محمد 571\n\n"
        "⚠️ **تنبيه:** لا يمكن إلغاء الاشتراك بعد التسجيل.",
        parse_mode='Markdown'
    )

async def subscribe_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    chat_id = str(update.message.chat_id)
    user_id = str(user.id)
    
    text = update.message.text.replace('/subscribe', '').strip()
    
    if not text:
        await update.message.reply_text(
            "⚠️ يرجى إرسال اسم الحالة ورقمها.\n\n"
            "مثال:\n"
            "/subscribe أحمد محمد 571"
        )
        return
    
    parts = text.split()
    if len(parts) >= 2:
        case_name = ' '.join(parts[:-1])
        case_serial = parts[-1]
    else:
        case_name = text
        case_serial = ''
    
    add_subscriber(
        chat_id=chat_id,
        user_id=user_id,
        case_id=f"sub_{chat_id}",
        case_name=case_name,
        case_serial=case_serial
    )
    
    await update.message.reply_text(
        WELCOME_MESSAGE.format(main_bot_url=MAIN_BOT_URL),
        parse_mode='Markdown'
    )
    
    # إشعار للمدير
    bot = Bot(token=KEEPER_BOT_TOKEN)
    await bot.send_message(
        chat_id=ADMIN_ID,
        text=f"🆕 مشترك جديد!\n👤 {case_name}\n🆔 {case_serial}\n💬 {chat_id}"
    )

async def excuse_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """معالجة الأعذار (قبل مواعيد الإرسال فقط)"""
    if not update.message or not update.message.from_user:
        return
    
    chat_id = str(update.message.chat_id)
    text = update.message.text.replace('/excuse', '').strip()
    day = datetime.now().day
    
    # التحقق: العذر يقبل فقط قبل يوم 24
    if day >= SEND_START_DAY:
        await update.message.reply_text(
            "⚠️ لا يمكن قبول الأعذار بعد بدء فترة الإرسال.\n"
            "فترة قبول الأعذار تنتهي يوم 23 من كل شهر."
        )
        return
    
    if not text:
        await update.message.reply_text(
            "⚠️ يرجى كتابة سبب العذر.\n\n"
            "مثال:\n"
            "/excuse ظروف صحية تمنعني من الإرسال"
        )
        return
    
    # الحصول على معلومات المشترك
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT case_name, case_serial FROM keeper_subscribers WHERE chat_id = ? AND is_active = 1', (chat_id,))
    sub = cursor.fetchone()
    conn.close()
    
    if not sub:
        await update.message.reply_text("⚠️ أنت غير مسجل في خدمة التذكير.")
        return
    
    # تسجيل العذر
    add_excuse(sub['case_serial'] or chat_id, sub['case_name'], text)
    
    # إشعار للمدير
    bot = Bot(token=KEEPER_BOT_TOKEN)
    await bot.send_message(
        chat_id=ADMIN_ID,
        text=f"📝 عذر جديد:\n👤 {sub['case_name']}\n🆔 {sub['case_serial']}\n📋 السبب: {text}\n📅 التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )
    
    await update.message.reply_text(
        "✅ تم تسجيل عذرك بنجاح.\n"
        "سيتم مراجعته من قبل الإدارة."
    )

async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.from_user:
        return
    
    chat_id = str(update.message.chat_id)
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT case_name, case_serial, subscribed_at, reminder_count 
        FROM keeper_subscribers 
        WHERE chat_id = ? AND is_active = 1
    ''', (chat_id,))
    sub = cursor.fetchone()
    conn.close()
    
    if sub:
        await update.message.reply_text(
            f"✅ أنت مسجل في خدمة التذكير.\n\n"
            f"👤 الاسم: {sub['case_name']}\n"
            f"🆔 الرقم: {sub['case_serial'] or 'غير معروف'}\n"
            f"📅 تاريخ الاشتراك: {sub['subscribed_at'][:10] if sub['subscribed_at'] else 'غير معروف'}\n"
            f"📊 عدد التذكيرات المستلمة: {sub['reminder_count']}\n\n"
            f"🗓️ ستتلقى تذكيرات بـ:\n"
            f"• مواعيد الإرسال (24-29)\n"
            f"• مواعيد القبض (فرع شبرا 1-7، فرع النهضة 1-4)\n\n"
            f"⚠️ لا يمكن إلغاء الاشتراك.\n"
            f"لإرسال عذر، استخدم: /excuse سبب العذر (قبل يوم 24 فقط)"
        )
    else:
        await update.message.reply_text(
            "⚠️ أنت غير مسجل في خدمة التذكير.\n\n"
            "للتسجيل، أرسل:\n"
            "/subscribe اسم الحالة رقم الحالة"
        )

# ============================================================
# دوال الربط مع النظام الرئيسي
# ============================================================

def subscribe_user(chat_id: str, user_id: str, case_id: str, 
                   case_name: str, case_serial: str = '') -> bool:
    return add_subscriber(chat_id, user_id, case_id, case_name, case_serial)

def get_subscribers_list() -> List[Dict]:
    return get_all_subscribers()

def get_stats() -> Dict:
    return {'total': get_subscribers_count()}

# ============================================================
# الجدولة والتشغيل
# ============================================================

def run_scheduler():
    schedule.every().day.at(f"{REMINDER_HOUR:02d}:{REMINDER_MINUTE:02d}").do(
        lambda: asyncio.run(check_and_send_reminders())
    )
    
    while True:
        schedule.run_pending()
        time.sleep(60)

def main():
    init_database()
    
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    app = ApplicationBuilder().token(KEEPER_BOT_TOKEN).build()
    
    app.add_handler(CommandHandler('start', start_command))
    app.add_handler(CommandHandler('subscribe', subscribe_command))
    app.add_handler(CommandHandler('excuse', excuse_command))
    app.add_handler(CommandHandler('status', status_command))
    
    # لا يوجد /unsubscribe
    
    print("=" * 50)
    print("✅ بوت التذكير (Keeper Bot) يعمل...")
    print(f"🤖 التوكن: {KEEPER_BOT_TOKEN[:10]}...")
    print(f"👑 معرف المدير: {ADMIN_ID}")
    print(f"⏰ وقت التذكير: {REMINDER_HOUR:02d}:{REMINDER_MINUTE:02d}")
    print(f"📋 نوع التذكيرات:")
    print(f"   • مواعيد الإرسال (24-29) - يبدأ قبل 7 أيام")
    print(f"   • مواعيد القبض (فرع شبرا 1-7، فرع النهضة 1-4)")
    print(f"⚠️ لا يوجد أمر /unsubscribe - المشترك لا يستطيع إلغاء اشتراكه")
    print(f"📋 الأعذار تقبل فقط قبل يوم 24")
    print(f"📋 عدد المشتركين الحالي: {get_subscribers_count()}")
    print("=" * 50)
    
    app.run_polling()

if __name__ == '__main__':
    main()
