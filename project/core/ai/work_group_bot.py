# core/ai/work_group_bot.py
# بوت جروب العمل - إدارة الباحثين وجلب صورهم من تليجرام
# المرجع: PROJECT_CONTEXT.txt
# المهام:
# 1. إدارة جروب العمل الخاص بالباحثين
# 2. جلب صور الباحثين من تليجرام تلقائياً
# 3. تحديث الصور عند تغييرها
# 4. تسجيل دخول الباحثين وخروجهم

import asyncio
import sqlite3
import os
import json
import re
from datetime import datetime
from typing import Optional, Dict, Any
import requests

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters, ChatMemberHandler
)

# ============================================================
# الإعدادات (CONFIGURATION)
# ============================================================

# توكن البوت (نفس توكن البوت الرئيسي أو توكن منفصل)
# يفضل استخدام توكن منفصل لبوت جروب العمل
WORK_GROUP_BOT_TOKEN = '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk'

# معرف جروب العمل (سيتم تعيينه بعد إنشاء الجروب)
WORK_GROUP_CHAT_ID = -1001639560426  # مؤقت، سيتم تحديثه

# معرف المدير
ADMIN_ID = 2130979393

# مسار قاعدة البيانات
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(BASE_DIR, 'data', 'local.db')

# ============================================================
# قائمة الباحثين المعتمدين
# ============================================================

RESEARCHERS = {
    'ali': {'name': 'علي', 'telegram_username': 'ali_researcher', 'gender': 'male'},
    'ashraf': {'name': 'أشرف', 'telegram_username': 'ashraf_researcher', 'gender': 'male'},
    'beshra': {'name': 'بشرى', 'telegram_username': 'beshra_researcher', 'gender': 'female'},
    'aya': {'name': 'آية', 'telegram_username': 'aya_researcher', 'gender': 'female'},
    'reham': {'name': 'ريهام', 'telegram_username': 'reham_researcher', 'gender': 'female'}
}

# ============================================================
# دوال قاعدة البيانات
# ============================================================

def init_database():
    """تهيئة قاعدة البيانات وجداول الباحثين"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # جدول الباحثين مع صورهم
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS researchers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            telegram_user_id TEXT,
            telegram_username TEXT,
            avatar_base64 TEXT,
            avatar_source TEXT DEFAULT 'telegram',
            last_synced TEXT,
            is_active INTEGER DEFAULT 1,
            joined_at TEXT,
            last_seen TEXT
        )
    ''')
    
    # جدول سجل الحضور والانصراف
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS researcher_attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            researcher_id TEXT,
            action TEXT,  -- check_in, check_out
            timestamp TEXT,
            source TEXT,  -- telegram, manual
            notes TEXT
        )
    ''')
    
    # جدول سجل تحديث الصور
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS avatar_update_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            researcher_id TEXT,
            old_avatar_hash TEXT,
            new_avatar_hash TEXT,
            updated_at TEXT,
            source TEXT
        )
    ''')
    
    # إضافة الباحثين الافتراضيين إذا لم يكونوا موجودين
    for rid, rdata in RESEARCHERS.items():
        cursor.execute('SELECT * FROM researchers WHERE id = ?', (rid,))
        if not cursor.fetchone():
            cursor.execute('''
                INSERT INTO researchers (id, name, telegram_username, joined_at, is_active)
                VALUES (?, ?, ?, ?, 1)
            ''', (rid, rdata['name'], rdata['telegram_username'], datetime.now().isoformat()))
    
    conn.commit()
    conn.close()
    print(f"✅ قاعدة بيانات بوت جروب العمل جاهزة: {DB_PATH}")

def get_researcher_by_telegram_id(telegram_user_id: str) -> Optional[Dict]:
    """الحصول على باحث بواسطة معرف التليجرام"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM researchers WHERE telegram_user_id = ?', (telegram_user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_researcher_by_username(username: str) -> Optional[Dict]:
    """الحصول على باحث بواسطة اسم المستخدم"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM researchers WHERE telegram_username = ?', (username,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_researcher_avatar(researcher_id: str, avatar_base64: str, source: str = 'telegram'):
    """تحديث صورة الباحث في قاعدة البيانات"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    # الحصول على الصورة القديمة لتسجيل التغيير
    cursor.execute('SELECT avatar_base64 FROM researchers WHERE id = ?', (researcher_id,))
    old = cursor.fetchone()
    old_hash = hash(old[0]) if old and old[0] else None
    new_hash = hash(avatar_base64)
    
    # تحديث الصورة
    cursor.execute('''
        UPDATE researchers 
        SET avatar_base64 = ?, last_synced = ?
        WHERE id = ?
    ''', (avatar_base64, now, researcher_id))
    
    # تسجيل التغيير في سجل التحديثات
    cursor.execute('''
        INSERT INTO avatar_update_log (researcher_id, old_avatar_hash, new_avatar_hash, updated_at, source)
        VALUES (?, ?, ?, ?, ?)
    ''', (researcher_id, old_hash, new_hash, now, source))
    
    conn.commit()
    conn.close()
    print(f"✅ تم تحديث صورة الباحث {researcher_id}")

def update_researcher_telegram_id(researcher_id: str, telegram_user_id: str):
    """تحديث معرف التليجرام للباحث"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE researchers 
        SET telegram_user_id = ?, last_seen = ?
        WHERE id = ?
    ''', (telegram_user_id, datetime.now().isoformat(), researcher_id))
    conn.commit()
    conn.close()

def record_attendance(researcher_id: str, action: str, source: str = 'telegram', notes: str = ''):
    """تسجيل حضور أو انصراف باحث"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO researcher_attendance (researcher_id, action, timestamp, source, notes)
        VALUES (?, ?, ?, ?, ?)
    ''', (researcher_id, action, datetime.now().isoformat(), source, notes))
    
    # تحديث آخر ظهور
    cursor.execute('''
        UPDATE researchers SET last_seen = ? WHERE id = ?
    ''', (datetime.now().isoformat(), researcher_id))
    
    conn.commit()
    conn.close()

def get_all_researchers() -> list:
    """الحصول على جميع الباحثين"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM researchers WHERE is_active = 1')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

# ============================================================
# دوال جلب الصور من تليجرام
# ============================================================

async def fetch_user_avatar(bot, user_id: int) -> Optional[str]:
    """
    جلب صورة المستخدم من تليجرام
    يعيد base64 للصورة أو None إذا لم توجد
    """
    try:
        # الحصول على صورة البروفايل
        photos = await bot.get_user_profile_photos(user_id, limit=1)
        if photos and photos.photos:
            # الحصول على أكبر صورة متاحة
            file_id = photos.photos[0][-1].file_id
            file = await bot.get_file(file_id)
            
            # تحميل الصورة
            image_data = await file.download_as_bytearray()
            
            # تحويل إلى base64
            import base64
            base64_image = base64.b64encode(image_data).decode('utf-8')
            
            # تحديد نوع الصورة (jpeg/png)
            if image_data[:4] == b'\x89PNG':
                mime = 'image/png'
            else:
                mime = 'image/jpeg'
            
            return f"data:{mime};base64,{base64_image}"
    except Exception as e:
        print(f"❌ فشل جلب صورة المستخدم {user_id}: {e}")
    
    return None

async def sync_all_researcher_avatars(bot):
    """مزامنة صور جميع الباحثين"""
    researchers = get_all_researchers()
    results = {'success': 0, 'failed': 0, 'not_found': 0}
    
    for researcher in researchers:
        if researcher.get('telegram_user_id'):
            try:
                user_id = int(researcher['telegram_user_id'])
                avatar = await fetch_user_avatar(bot, user_id)
                if avatar:
                    update_researcher_avatar(researcher['id'], avatar, 'telegram')
                    results['success'] += 1
                    print(f"✅ تم تحديث صورة {researcher['name']}")
                else:
                    results['not_found'] += 1
            except Exception as e:
                print(f"❌ فشل تحديث صورة {researcher['name']}: {e}")
                results['failed'] += 1
        else:
            results['not_found'] += 1
    
    return results

# ============================================================
# معالجة الرسائل والأحداث
# ============================================================

async def handle_new_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """معالجة انضمام عضو جديد إلى الجروب"""
    if not update.my_chat_member:
        return
    
    chat_member = update.my_chat_member
    user = chat_member.new_chat_member.user
    
    # التحقق مما إذا كان العضو الجديد باحثاً معتمداً
    researcher = get_researcher_by_telegram_id(str(user.id))
    
    if researcher:
        # تحديث معرف التليجرام إذا لم يكن موجوداً
        if not researcher.get('telegram_user_id'):
            update_researcher_telegram_id(researcher['id'], str(user.id))
        
        # ترحيب بالباحث
        welcome_msg = f"""
👋 مرحباً أستاذ {researcher['name']}

✅ تم التعرف عليك كباحث في نظام إدارة البحث الاجتماعي.

📋 عهدتك الورقية: {get_researcher_custody_range(researcher['id'])}

🖼️ تم جلب صورتك الشخصية من تليجرام لتظهر في النظام.

📌 يمكنك الآن:
• تسجيل حضورك بأمر /checkin
• تسجيل انصرافك بأمر /checkout
• عرض مهامك بأمر /tasks

نتمنى لك يوماً موفقاً!
"""
        await update.message.reply_text(welcome_msg)
        
        # جلب الصورة وتحديثها
        avatar = await fetch_user_avatar(context.bot, user.id)
        if avatar:
            update_researcher_avatar(researcher['id'], avatar, 'telegram')
            await update.message.reply_text("✅ تم جلب صورتك الشخصية وتحديثها في النظام.")
    else:
        # عضو غير معتمد
        await update.message.reply_text(
            "⚠️ مرحباً بك. لكن اسمك غير مسجل في قائمة الباحثين المعتمدين.\n"
            "يرجى التواصل مع المدير لإضافتك إلى النظام."
        )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """معالجة الرسائل العادية في الجروب"""
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    message_text = update.message.text.strip() if update.message.text else ""
    
    # التحقق من أن المرسل باحث معتمد
    researcher = get_researcher_by_telegram_id(str(user.id))
    if not researcher:
        await update.message.reply_text("⚠️ غير مصرح لك باستخدام هذا البوت. يرجى التواصل مع المدير.")
        return
    
    # معالجة الأوامر
    if message_text.startswith('/'):
        await handle_command(update, context, researcher, message_text)
    else:
        # رسالة عادية - يمكن تجاهلها أو تسجيلها
        pass

async def handle_command(update: Update, context: ContextTypes.DEFAULT_TYPE, researcher: Dict, command: str):
    """معالجة الأوامر الصادرة من الباحثين"""
    
    if command == '/checkin' or command == '/حضور':
        # تسجيل حضور
        record_attendance(researcher['id'], 'check_in', 'telegram')
        await update.message.reply_text(
            f"✅ تم تسجيل حضورك بنجاح أستاذ {researcher['name']}\n"
            f"🕐 الوقت: {datetime.now().strftime('%H:%M:%S')}\n"
            f"📅 التاريخ: {datetime.now().strftime('%Y-%m-%d')}\n\n"
            f"📋 مهام اليوم متاحة في النظام."
        )
        
    elif command == '/checkout' or command == '/انصراف':
        # تسجيل انصراف
        record_attendance(researcher['id'], 'check_out', 'telegram')
        await update.message.reply_text(
            f"✅ تم تسجيل انصرافك بنجاح أستاذ {researcher['name']}\n"
            f"🕐 الوقت: {datetime.now().strftime('%H:%M:%S')}\n"
            f"📅 التاريخ: {datetime.now().strftime('%Y-%m-%d')}\n\n"
            f"📊 إنجازات اليوم متاحة في تقرير الأداء."
        )
        
    elif command == '/tasks' or command == '/مهام':
        # عرض المهام
        await update.message.reply_text(
            f"📋 مهام اليوم أستاذ {researcher['name']}:\n\n"
            f"1. مراجعة الحالات الجديدة في عهدتك\n"
            f"2. تحديث بيانات الحالات الناقصة\n"
            f"3. التخطيط للزيارات الميدانية\n"
            f"4. إدخال تقارير الزيارات\n\n"
            f"💡 لمزيد من التفاصيل، افتح النظام على جهازك."
        )
        
    elif command == '/status' or command == '/حالة':
        # عرض حالة الباحث
        await update.message.reply_text(
            f"📊 حالة أستاذ {researcher['name']}:\n\n"
            f"• عدد الحالات في عهدتك: {get_researcher_cases_count(researcher['id'])}\n"
            f"• الحالات المنجزة هذا الشهر: {get_researcher_completed_count(researcher['id'])}\n"
            f"• آخر حضور: {get_last_attendance(researcher['id'])}\n\n"
            f"📈 استمر في العطاء!"
        )
        
    elif command == '/sync' or command == '/تحديث':
        # تحديث الصورة
        await update.message.reply_text("⏳ جاري تحديث صورتك...")
        avatar = await fetch_user_avatar(context.bot, update.message.from_user.id)
        if avatar:
            update_researcher_avatar(researcher['id'], avatar, 'telegram')
            await update.message.reply_text("✅ تم تحديث صورتك الشخصية بنجاح.")
        else:
            await update.message.reply_text("⚠️ لم نتمكن من جلب صورتك. تأكد من وجود صورة لحسابك.")
    
    elif command == '/help' or command == '/مساعدة':
        await update.message.reply_text(
            "📚 الأوامر المتاحة:\n\n"
            "/checkin - تسجيل حضور\n"
            "/checkout - تسجيل انصراف\n"
            "/tasks - عرض المهام\n"
            "/status - عرض حالتك\n"
            "/sync - تحديث صورتك الشخصية\n"
            "/help - عرض هذه المساعدة"
        )
    
    else:
        await update.message.reply_text(f"⚠️ أمر غير معروف: {command}\nاكتب /help لعرض الأوامر المتاحة.")

async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """معالجة الصور المرسلة (لتحديث الصورة الشخصية)"""
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    researcher = get_researcher_by_telegram_id(str(user.id))
    
    if not researcher:
        await update.message.reply_text("⚠️ غير مصرح لك باستخدام هذه الميزة.")
        return
    
    # الحصول على الصورة
    photo = update.message.photo[-1]  # أكبر صورة
    file = await context.bot.get_file(photo.file_id)
    image_data = await file.download_as_bytearray()
    
    # تحويل إلى base64
    import base64
    base64_image = base64.b64encode(image_data).decode('utf-8')
    
    # تحديد نوع الصورة
    if image_data[:4] == b'\x89PNG':
        mime = 'image/png'
    else:
        mime = 'image/jpeg'
    
    avatar_base64 = f"data:{mime};base64,{base64_image}"
    update_researcher_avatar(researcher['id'], avatar_base64, 'manual')
    
    await update.message.reply_text("✅ تم تحديث صورتك الشخصية بنجاح.")

# ============================================================
# دوال مساعدة للإحصائيات
# ============================================================

def get_researcher_custody_range(researcher_id: str) -> str:
    """الحصول على نطاق العهدة الورقية للباحث"""
    ranges = {
        'beshra': 'حالات 1 → 200',
        'aya': 'حالات 201 → 400',
        'reham': 'حالات 401 → 600',
        'ali': 'حالات 601 → 800',
        'ashraf': 'حالات 801 → 1000'
    }
    return ranges.get(researcher_id, 'غير محدد')

def get_researcher_cases_count(researcher_id: str) -> int:
    """الحصول على عدد الحالات في عهدة الباحث"""
    # هذا سيتم ربطه بقاعدة البيانات لاحقاً
    return 200

def get_researcher_completed_count(researcher_id: str) -> int:
    """الحصول على عدد الحالات المنجزة هذا الشهر"""
    # هذا سيتم ربطه بقاعدة البيانات لاحقاً
    return 145

def get_last_attendance(researcher_id: str) -> str:
    """الحصول على تاريخ آخر حضور"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT timestamp FROM researcher_attendance 
        WHERE researcher_id = ? AND action = 'check_in'
        ORDER BY timestamp DESC LIMIT 1
    ''', (researcher_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return row[0][:10]  # التاريخ فقط
    return 'لم يسجل بعد'

# ============================================================
# API للربط مع النظام الرئيسي
# ============================================================

def get_researcher_avatar_base64(researcher_id: str) -> Optional[str]:
    """الحصول على صورة الباحث بتنسيق base64 (للاستخدام من الواجهة)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT avatar_base64 FROM researchers WHERE id = ?', (researcher_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else None

def get_all_researchers_with_avatars() -> list:
    """الحصول على جميع الباحثين مع صورهم (للاستخدام في admin/index.html)"""
    researchers = get_all_researchers()
    result = []
    for r in researchers:
        result.append({
            'id': r['id'],
            'name': r['name'],
            'telegram_user_id': r.get('telegram_user_id'),
            'telegram_username': r.get('telegram_username'),
            'avatar_base64': r.get('avatar_base64'),
            'last_synced': r.get('last_synced'),
            'is_active': r.get('is_active', 1)
        })
    return result

# ============================================================
# تشغيل البوت
# ============================================================

async def post_init(application):
    """ما بعد تهيئة البوت"""
    print("✅ بوت جروب العمل (Work Group Bot) يعمل...")
    print(f"🤖 التوكن: {WORK_GROUP_BOT_TOKEN[:10]}...")
    
    # مزامنة صور جميع الباحثين عند بدء التشغيل
    print("⏳ جاري مزامنة صور الباحثين...")
    results = await sync_all_researcher_avatars(application.bot)
    print(f"📊 نتائج المزامنة: نجاح {results['success']} / فشل {results['failed']} / غير موجود {results['not_found']}")

def main():
    """تشغيل البوت"""
    init_database()
    
    # إنشاء التطبيق
    app = ApplicationBuilder().token(WORK_GROUP_BOT_TOKEN).post_init(post_init).build()
    
    # إضافة معالجات الأحداث
    app.add_handler(ChatMemberHandler(handle_new_chat_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(CommandHandler('checkin', handle_message))
    app.add_handler(CommandHandler('checkout', handle_message))
    app.add_handler(CommandHandler('tasks', handle_message))
    app.add_handler(CommandHandler('status', handle_message))
    app.add_handler(CommandHandler('sync', handle_message))
    app.add_handler(CommandHandler('help', handle_message))
    
    print("=" * 50)
    print("✅ بوت جروب العمل (Work Group Bot) يعمل...")
    print(f"🤖 التوكن: {WORK_GROUP_BOT_TOKEN[:10]}...")
    print(f"👑 معرف المدير: {ADMIN_ID}")
    print("📋 المهام:")
    print("   • جلب صور الباحثين من تليجرام")
    print("   • تسجيل حضور وانصراف الباحثين")
    print("   • تحديث الصور تلقائياً عند تغييرها")
    print("=" * 50)
    
    # تشغيل البوت
    app.run_polling()

if __name__ == '__main__':
    main()
