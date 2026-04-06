# =====================================================================
# core/ai/locations_group_bot.py
# بوت جروب مواقع الحالات - تتبع مواقع الحالات أثناء الزيارات الميدانية
# المرجع: PROJECT_CONTEXT.txt
# المهام:
# 1. استقبال مواقع الحالات من الباحثين (لوكيشن)
# 2. حفظ المواقع في قاعدة البيانات
# 3. عرض المواقع على الخريطة
# 4. تنبيه الباحثين إذا كانت الحالة قريبة
# =====================================================================

import asyncio
import sqlite3
import os
import json
import re
from datetime import datetime
from typing import Optional, Dict, Any, List
import requests

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters
)

# ============================================================
# الإعدادات (CONFIGURATION)
# ============================================================

# توكن البوت (نفس توكن البوت الرئيسي)
LOCATIONS_BOT_TOKEN = '7204378934:AAEhAOi0f5fDdWqoMe7YGrsuxl5hev-w_Yk'

# معرف جروب مواقع الحالات
LOCATIONS_GROUP_CHAT_ID = -1001639560426  # سيتم تحديثه بعد إنشاء الجروب

# معرف المدير
ADMIN_ID = 2130979393

# مسار قاعدة البيانات
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(BASE_DIR, 'data', 'local.db')

# المسافة القصوى للتنبيه (بالأمتار)
PROXIMITY_ALERT_DISTANCE = 500  # 500 متر

# ============================================================
# دوال قاعدة البيانات
# ============================================================

def init_database():
    """تهيئة قاعدة البيانات وجداول المواقع"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # جدول مواقع الحالات
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS case_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT NOT NULL,
            case_name TEXT NOT NULL,
            case_serial TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT,
            reported_by TEXT,
            reported_at TEXT,
            visit_date TEXT,
            is_verified INTEGER DEFAULT 0,
            notes TEXT
        )
    ''')
    
    # جدول سجل الزيارات الميدانية
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS field_visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            researcher_id TEXT,
            researcher_name TEXT,
            case_id TEXT,
            case_name TEXT,
            check_in_time TEXT,
            check_out_time TEXT,
            latitude REAL,
            longitude REAL,
            visit_duration INTEGER,
            notes TEXT
        )
    ''')
    
    # إنشاء فهارس للبحث السريع
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_case_locations_case_id ON case_locations(case_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_field_visits_researcher ON field_visits(researcher_id)')
    
    conn.commit()
    conn.close()
    print(f"✅ قاعدة بيانات بوت مواقع الحالات جاهزة: {DB_PATH}")

def save_case_location(case_id: str, case_name: str, case_serial: str, 
                       latitude: float, longitude: float, address: str,
                       reported_by: str, notes: str = '') -> bool:
    """حفظ موقع حالة في قاعدة البيانات"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    cursor.execute('''
        INSERT INTO case_locations 
        (case_id, case_name, case_serial, latitude, longitude, address, reported_by, reported_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (case_id, case_name, case_serial, latitude, longitude, address, reported_by, now, notes))
    
    conn.commit()
    conn.close()
    print(f"✅ تم حفظ موقع الحالة {case_name} ({case_id})")
    return True

def get_case_location(case_id: str) -> Optional[Dict]:
    """الحصول على موقع حالة من قاعدة البيانات"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM case_locations 
        WHERE case_id = ? 
        ORDER BY reported_at DESC LIMIT 1
    ''', (case_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_locations() -> List[Dict]:
    """الحصول على جميع مواقع الحالات"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM case_locations 
        ORDER BY reported_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def start_field_visit(researcher_id: str, researcher_name: str, 
                      case_id: str, case_name: str,
                      latitude: float, longitude: float) -> int:
    """بدء زيارة ميدانية (تسجيل حضور)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    cursor.execute('''
        INSERT INTO field_visits 
        (researcher_id, researcher_name, case_id, case_name, check_in_time, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (researcher_id, researcher_name, case_id, case_name, now, latitude, longitude))
    
    visit_id = cursor.lastrowid
    conn.commit()
    conn.close()
    print(f"✅ بدأ الباحث {researcher_name} زيارة للحالة {case_name}")
    return visit_id

def end_field_visit(visit_id: int, latitude: float = None, longitude: float = None, notes: str = ''):
    """إنهاء زيارة ميدانية (تسجيل انصراف)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    # الحصول على وقت البدء
    cursor.execute('SELECT check_in_time FROM field_visits WHERE id = ?', (visit_id,))
    row = cursor.fetchone()
    if row:
        start_time = datetime.fromisoformat(row[0])
        end_time = datetime.now()
        duration = int((end_time - start_time).total_seconds() / 60)  # بالدقائق
        
        update_fields = 'check_out_time = ?, visit_duration = ?'
        params = [now, duration]
        
        if latitude and longitude:
            update_fields += ', latitude = ?, longitude = ?'
            params.extend([latitude, longitude])
        
        if notes:
            update_fields += ', notes = ?'
            params.append(notes)
        
        params.append(visit_id)
        cursor.execute(f'''
            UPDATE field_visits 
            SET {update_fields}
            WHERE id = ?
        ''', params)
        
        conn.commit()
        print(f"✅ انتهى الباحث من الزيارة (المدة: {duration} دقيقة)")
    
    conn.close()

def get_nearby_cases(latitude: float, longitude: float, distance_meters: int = 500) -> List[Dict]:
    """الحصول على الحالات القريبة من موقع معين"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # استخدام صيغة هافرسين لحساب المسافة
    cursor.execute('''
        SELECT *, (
            6371 * acos(
                cos(radians(?)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(latitude))
            )
        ) * 1000 as distance
        FROM case_locations
        HAVING distance < ?
        ORDER BY distance
    ''', (latitude, longitude, latitude, distance_meters))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

# ============================================================
# دوال معالجة المواقع
# ============================================================

def parse_location_message(text: str) -> Optional[Dict]:
    """استخراج الإحداثيات من رسالة نصية"""
    # تنسيق: 30.123456, 31.123456
    coord_pattern = r'(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)'
    match = re.search(coord_pattern, text)
    
    if match:
        return {
            'latitude': float(match.group(1)),
            'longitude': float(match.group(2))
        }
    
    # تنسيق: latitude: 30.123456, longitude: 31.123456
    lat_pattern = r'lat(?:itude)?[:\s]*(-?\d+\.\d+)'
    lng_pattern = r'lng(?:itude)?[:\s]*(-?\d+\.\d+)'
    
    lat_match = re.search(lat_pattern, text, re.IGNORECASE)
    lng_match = re.search(lng_pattern, text, re.IGNORECASE)
    
    if lat_match and lng_match:
        return {
            'latitude': float(lat_match.group(1)),
            'longitude': float(lng_match.group(1))
        }
    
    return None

async def reverse_geocode(latitude: float, longitude: float) -> str:
    """تحويل الإحداثيات إلى عنوان نصي (عكس الترميز الجغرافي)"""
    try:
        # استخدام خدمة Nominatim (OpenStreetMap)
        url = f"https://nominatim.openstreetmap.org/reverse?lat={latitude}&lon={longitude}&format=json&accept-language=ar"
        response = requests.get(url, headers={'User-Agent': 'CharitySystem/1.0'}, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            return data.get('display_name', f"{latitude}, {longitude}")
    except Exception as e:
        print(f"❌ فشل عكس الترميز: {e}")
    
    return f"{latitude}, {longitude}"

# ============================================================
# معالجة الرسائل والأوامر
# ============================================================

async def handle_location(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """معالجة موقع مرسل من الباحث"""
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    researcher_name = user.first_name or user.username or 'باحث'
    researcher_id = str(user.id)
    
    # الحصول على الموقع
    if update.message.location:
        latitude = update.message.location.latitude
        longitude = update.message.location.longitude
    else:
        # محاولة استخراج الإحداثيات من النص
        coords = parse_location_message(update.message.text)
        if not coords:
            await update.message.reply_text(
                "⚠️ لم أتمكن من استخراج الموقع.\n\n"
                "يرجى إرسال الموقع كـ Location من التطبيق،\n"
                "أو كتابة الإحداثيات بهذا التنسيق:\n"
                "`30.123456, 31.123456`\n\n"
                "أو:\n"
                "`latitude: 30.123456, longitude: 31.123456`",
                parse_mode='Markdown'
            )
            return
        latitude = coords['latitude']
        longitude = coords['longitude']
    
    # استخراج معلومات الحالة من النص (إذا وجدت)
    text = update.message.text or ""
    case_id = None
    case_name = None
    case_serial = None
    
    # البحث عن أرقام الحالات
    numbers = re.findall(r'\d+', text)
    if numbers:
        case_serial = numbers[0]
    
    # البحث عن أسماء الحالات (كلمات عربية)
    words = re.findall(r'[\u0600-\u06FF]+', text)
    if words and len(words) > 0:
        case_name = words[0] if len(words) > 0 else None
    
    # عكس الترميز للحصول على العنوان
    address = await reverse_geocode(latitude, longitude)
    
    # حفظ الموقع
    case_id_display = case_id or case_serial or f"unknown_{int(datetime.now().timestamp())}"
    case_name_display = case_name or "حالة غير معروفة"
    
    save_case_location(
        case_id=case_id_display,
        case_name=case_name_display,
        case_serial=case_serial,
        latitude=latitude,
        longitude=longitude,
        address=address,
        reported_by=researcher_name,
        notes=text[:500] if text else ''
    )
    
    # البحث عن حالات قريبة
    nearby = get_nearby_cases(latitude, longitude, PROXIMITY_ALERT_DISTANCE)
    
    # الرد على الباحث
    response = f"✅ تم تسجيل موقع الحالة: {case_name_display}\n\n"
    response += f"📍 العنوان: {address[:200]}\n"
    response += f"📏 الإحداثيات: {latitude}, {longitude}\n\n"
    
    if nearby and len(nearby) > 1:  # أكثر من الحالة الحالية
        response += f"🔔 توجد {len(nearby) - 1} حالات قريبة (ضمن {PROXIMITY_ALERT_DISTANCE} متر):\n"
        for loc in nearby[:5]:  # عرض أول 5 حالات قريبة
            if loc['case_id'] != case_id_display:
                dist = loc.get('distance', 0)
                response += f"  • {loc['case_name']} - على بعد {dist:.0f} متر\n"
    
    # إضافة زر لفتح الخريطة
    keyboard = [[
        InlineKeyboardButton("🗺️ فتح في خرائط جوجل", url=f"https://www.google.com/maps?q={latitude},{longitude}")
    ]]
    
    await update.message.reply_text(response, reply_markup=InlineKeyboardMarkup(keyboard))

async def handle_checkin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """تسجيل بدء زيارة ميدانية"""
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    researcher_name = user.first_name or user.username or 'باحث'
    researcher_id = str(user.id)
    
    # استخراج معلومات الحالة من النص
    text = update.message.text
    parts = text.split()
    
    if len(parts) < 2:
        await update.message.reply_text(
            "⚠️ يرجى كتابة رقم الحالة أو اسمها.\n\n"
            "مثال:\n"
            "/checkin 571 أحمد محمد"
        )
        return
    
    case_serial = parts[1] if len(parts) > 1 else None
    case_name = ' '.join(parts[2:]) if len(parts) > 2 else None
    
    # الحصول على الموقع الحالي (إذا أرسل الموقع مع الأمر)
    if not update.message.location:
        await update.message.reply_text(
            "⚠️ يرجى إرسال الموقع مع الأمر، أو إرسال الموقع بشكل منفصل.\n\n"
            "يمكنك إرسال موقعك الحالي من قائمة المرفقات."
        )
        return
    
    latitude = update.message.location.latitude
    longitude = update.message.location.longitude
    
    # تسجيل بدء الزيارة
    visit_id = start_field_visit(
        researcher_id=researcher_id,
        researcher_name=researcher_name,
        case_id=case_serial or case_name or f"unknown_{int(datetime.now().timestamp())}",
        case_name=case_name or "حالة غير معروفة",
        latitude=latitude,
        longitude=longitude
    )
    
    # حفظ visit_id في سياق المحادثة
    context.user_data['current_visit_id'] = visit_id
    
    await update.message.reply_text(
        f"✅ تم تسجيل بدء زيارة {case_name or case_serial}\n"
        f"👤 الباحث: {researcher_name}\n"
        f"🕐 الوقت: {datetime.now().strftime('%H:%M:%S')}\n\n"
        f"عند الانتهاء، أرسل /checkout لتسجيل انتهاء الزيارة."
    )

async def handle_checkout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """تسجيل انتهاء زيارة ميدانية"""
    if not update.message or not update.message.from_user:
        return
    
    visit_id = context.user_data.get('current_visit_id')
    
    if not visit_id:
        await update.message.reply_text(
            "⚠️ لا توجد زيارة نشطة حالياً.\n"
            "يرجى بدء الزيارة أولاً باستخدام /checkin"
        )
        return
    
    # الحصول على الموقع الحالي (اختياري)
    latitude = None
    longitude = None
    if update.message.location:
        latitude = update.message.location.latitude
        longitude = update.message.location.longitude
    
    # إنهاء الزيارة
    end_field_visit(visit_id, latitude, longitude)
    
    # مسح visit_id من السياق
    del context.user_data['current_visit_id']
    
    await update.message.reply_text(
        f"✅ تم تسجيل انتهاء الزيارة\n"
        f"🕐 الوقت: {datetime.now().strftime('%H:%M:%S')}\n\n"
        f"شكراً لك على جهودك!"
    )

async def handle_nearby(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """البحث عن حالات قريبة من موقع معين"""
    if not update.message or not update.message.from_user:
        return
    
    # الحصول على الموقع
    if not update.message.location:
        await update.message.reply_text(
            "⚠️ يرجى إرسال موقعك الحالي للبحث عن الحالات القريبة.\n\n"
            "يمكنك إرسال موقعك من قائمة المرفقات."
        )
        return
    
    latitude = update.message.location.latitude
    longitude = update.message.location.longitude
    
    # البحث عن حالات قريبة
    nearby = get_nearby_cases(latitude, longitude, PROXIMITY_ALERT_DISTANCE)
    
    if not nearby:
        await update.message.reply_text(
            f"🔍 لا توجد حالات مسجلة ضمن {PROXIMITY_ALERT_DISTANCE} متر من موقعك."
        )
        return
    
    response = f"🔍 تم العثور على {len(nearby)} حالة ضمن {PROXIMITY_ALERT_DISTANCE} متر:\n\n"
    for loc in nearby[:10]:
        dist = loc.get('distance', 0)
        response += f"📍 {loc['case_name']} - {dist:.0f} متر\n"
        response += f"   🆔 {loc['case_serial'] or 'لا يوجد رقم'}\n"
        response += f"   📅 آخر تحديث: {loc['reported_at'][:10]}\n\n"
    
    await update.message.reply_text(response)

async def handle_map(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """عرض جميع مواقع الحالات على خريطة"""
    locations = get_all_locations()
    
    if not locations:
        await update.message.reply_text("📭 لا توجد مواقع حالات مسجلة حالياً.")
        return
    
    # إنشاء رابط خريطة بجميع المواقع
    markers = []
    for loc in locations[:20]:  # حد أقصى 20 علامة
        markers.append(f"{loc['latitude']},{loc['longitude']}")
    
    markers_param = '|'.join(markers)
    map_url = f"https://www.google.com/maps/dir//{markers_param}"
    
    response = f"🗺️ تم العثور على {len(locations)} موقع مسجل.\n\n"
    response += f"أحدث 5 مواقع:\n"
    for loc in locations[:5]:
        response += f"• {loc['case_name']} - {loc['reported_at'][:10]}\n"
    
    keyboard = [[
        InlineKeyboardButton("🗺️ عرض الكل على الخريطة", url=map_url)
    ]]
    
    await update.message.reply_text(response, reply_markup=InlineKeyboardMarkup(keyboard))

# ============================================================
# تشغيل البوت
# ============================================================

async def post_init(application):
    """ما بعد تهيئة البوت"""
    print("✅ بوت جروب مواقع الحالات (Locations Bot) يعمل...")
    print(f"🤖 التوكن: {LOCATIONS_BOT_TOKEN[:10]}...")
    print(f"📏 مسافة التنبيه: {PROXIMITY_ALERT_DISTANCE} متر")

def main():
    """تشغيل البوت"""
    init_database()
    
    # إنشاء التطبيق
    app = ApplicationBuilder().token(LOCATIONS_BOT_TOKEN).post_init(post_init).build()
    
    # إضافة معالجات الأحداث
    app.add_handler(MessageHandler(filters.LOCATION, handle_location))
    app.add_handler(CommandHandler('checkin', handle_checkin))
    app.add_handler(CommandHandler('checkout', handle_checkout))
    app.add_handler(CommandHandler('nearby', handle_nearby))
    app.add_handler(CommandHandler('map', handle_map))
    app.add_handler(CommandHandler('خريطة', handle_map))
    
    # معالجة الرسائل النصية التي تحتوي على إحداثيات
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_location))
    
    print("=" * 50)
    print("✅ بوت جروب مواقع الحالات (Locations Bot) يعمل...")
    print(f"🤖 التوكن: {LOCATIONS_BOT_TOKEN[:10]}...")
    print("📋 المهام:")
    print("   • استقبال مواقع الحالات من الباحثين")
    print("   • حفظ المواقع في قاعدة البيانات")
    print("   • تنبيه الباحثين للحالات القريبة")
    print("   • تسجيل بدء وانتهاء الزيارات الميدانية")
    print("=" * 50)
    
    # تشغيل البوت
    app.run_polling()

if __name__ == '__main__':
    main()
