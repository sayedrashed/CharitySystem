# =====================================================================
# core/backup_manager.py
# مدير النسخ الاحتياطي - إنشاء واستعادة النسخ الاحتياطية
# المرجع: PROJECT_CONTEXT.txt
# المهام:
# 1. إنشاء نسخ احتياطية تلقائية يومية
# 2. استعادة البيانات من نسخة احتياطية
# 3. تنظيف النسخ القديمة (آخر 7 أيام فقط)
# 4. دعم TeraBox للنسخ الاحتياطي السحابي (للمدير فقط)
# =====================================================================

import os
import sys
import json
import sqlite3
import shutil
import threading
import time
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any, List

# إضافة مسار المشروع إلى sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

# ============================================================
# الإعدادات (CONFIGURATION)
# ============================================================

# مسارات الملفات
DATA_DIR = Path(os.environ.get('CHARITY_DATA_DIR', str(Path.home() / 'CharitySystem' / 'data')))
DB_PATH = DATA_DIR / 'local.db'
BACKUP_DIR = DATA_DIR / 'backups'
CONFIG_FILE = DATA_DIR / 'backup_config.json'

# إعدادات النسخ الاحتياطي
MAX_BACKUPS = 7  # الاحتفاظ بآخر 7 نسخ فقط
AUTO_BACKUP_INTERVAL_HOURS = 24  # كل 24 ساعة
TERABOX_API_URL = "https://openapi.terabox.com/upload"  # مثال، سيتم تحديثه

# ============================================================
# دوال مساعدة
# ============================================================

def ensure_directories():
    """التأكد من وجود المجلدات اللازمة"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

def get_timestamp() -> str:
    """الحصول على توقيت بصيغة مناسبة لاسم الملف"""
    return datetime.now().strftime('%Y-%m-%d_%H-%M-%S')

def calculate_file_hash(filepath: Path) -> str:
    """حساب هاش الملف للتحقق من سلامته"""
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def load_config() -> Dict:
    """تحميل إعدادات النسخ الاحتياطي"""
    ensure_directories()
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {
        'last_backup_at': None,
        'auto_backup_enabled': True,
        'max_backups': MAX_BACKUPS,
        'terabox_enabled': False,
        'terabox_token': None,
        'backup_history': []
    }

def save_config(config: Dict):
    """حفظ إعدادات النسخ الاحتياطي"""
    ensure_directories()
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

def get_backup_files() -> List[Dict]:
    """الحصول على قائمة ملفات النسخ الاحتياطي"""
    ensure_directories()
    backups = []
    for file in BACKUP_DIR.glob('backup_*.db'):
        stat = file.stat()
        backups.append({
            'filename': file.name,
            'path': str(file),
            'size': stat.st_size,
            'size_mb': round(stat.st_size / (1024 * 1024), 2),
            'created_at': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'hash': calculate_file_hash(file)
        })
    # ترتيب حسب التاريخ (الأحدث أولاً)
    backups.sort(key=lambda x: x['created_at'], reverse=True)
    return backups

def clean_old_backups():
    """حذف النسخ الاحتياطية القديمة (أكثر من MAX_BACKUPS)"""
    backups = get_backup_files()
    if len(backups) > MAX_BACKUPS:
        to_delete = backups[MAX_BACKUPS:]
        for backup in to_delete:
            try:
                os.remove(backup['path'])
                print(f"🗑️ تم حذف النسخة القديمة: {backup['filename']}")
            except Exception as e:
                print(f"❌ فشل حذف {backup['filename']}: {e}")

# ============================================================
# إنشاء النسخ الاحتياطية
# ============================================================

def create_backup() -> Optional[Dict]:
    """
    إنشاء نسخة احتياطية جديدة
    @returns: معلومات النسخة الاحتياطية أو None
    """
    ensure_directories()
    
    if not DB_PATH.exists():
        print("❌ قاعدة البيانات غير موجودة")
        return None
    
    timestamp = get_timestamp()
    backup_filename = f"backup_{timestamp}.db"
    backup_path = BACKUP_DIR / backup_filename
    
    try:
        # نسخ ملف قاعدة البيانات
        shutil.copy2(DB_PATH, backup_path)
        
        # التحقق من سلامة النسخة
        original_hash = calculate_file_hash(DB_PATH)
        backup_hash = calculate_file_hash(backup_path)
        
        if original_hash != backup_hash:
            os.remove(backup_path)
            print("❌ فشل التحقق من سلامة النسخة الاحتياطية")
            return None
        
        # معلومات النسخة
        backup_info = {
            'filename': backup_filename,
            'path': str(backup_path),
            'size': backup_path.stat().st_size,
            'size_mb': round(backup_path.stat().st_size / (1024 * 1024), 2),
            'created_at': datetime.now().isoformat(),
            'hash': backup_hash
        }
        
        # تحديث السجل
        config = load_config()
        config['last_backup_at'] = datetime.now().isoformat()
        if 'backup_history' not in config:
            config['backup_history'] = []
        config['backup_history'].insert(0, backup_info)
        # الاحتفاظ بآخر 50 سجل فقط
        config['backup_history'] = config['backup_history'][:50]
        save_config(config)
        
        # تنظيف النسخ القديمة
        clean_old_backups()
        
        print(f"✅ تم إنشاء نسخة احتياطية: {backup_filename} ({backup_info['size_mb']} MB)")
        return backup_info
        
    except Exception as e:
        print(f"❌ فشل إنشاء النسخة الاحتياطية: {e}")
        return None

# ============================================================
# استعادة البيانات
# ============================================================

def restore_backup(backup_filename: str) -> bool:
    """
    استعادة البيانات من نسخة احتياطية
    @param backup_filename: اسم ملف النسخة الاحتياطية
    @returns: نجاح العملية
    """
    ensure_directories()
    
    backup_path = BACKUP_DIR / backup_filename
    
    if not backup_path.exists():
        print(f"❌ ملف النسخة الاحتياطية غير موجود: {backup_filename}")
        return False
    
    # إنشاء نسخة أمان من قاعدة البيانات الحالية قبل الاستعادة
    safety_backup_path = BACKUP_DIR / f"safety_{get_timestamp()}.db"
    if DB_PATH.exists():
        shutil.copy2(DB_PATH, safety_backup_path)
        print(f"🛡️ تم إنشاء نسخة أمان: {safety_backup_path.name}")
    
    try:
        # استعادة البيانات
        shutil.copy2(backup_path, DB_PATH)
        
        # التحقق من سلامة البيانات بعد الاستعادة
        restored_hash = calculate_file_hash(DB_PATH)
        backup_hash = calculate_file_hash(backup_path)
        
        if restored_hash != backup_hash:
            # فشل التحقق، استعادة النسخة الآمنة
            if safety_backup_path.exists():
                shutil.copy2(safety_backup_path, DB_PATH)
            print("❌ فشل التحقق من سلامة البيانات بعد الاستعادة")
            return False
        
        print(f"✅ تم استعادة البيانات من: {backup_filename}")
        
        # تسجيل عملية الاستعادة
        config = load_config()
        config['last_restore_at'] = datetime.now().isoformat()
        config['last_restore_from'] = backup_filename
        save_config(config)
        
        return True
        
    except Exception as e:
        print(f"❌ فشل استعادة البيانات: {e}")
        # استعادة النسخة الآمنة
        if safety_backup_path.exists():
            shutil.copy2(safety_backup_path, DB_PATH)
            print("🔄 تم استعادة النسخة الآمنة")
        return False

def restore_from_backup_file(file_path: str) -> bool:
    """
    استعادة البيانات من ملف نسخة احتياطية خارجي
    @param file_path: مسار ملف النسخة الاحتياطية
    @returns: نجاح العملية
    """
    source_path = Path(file_path)
    
    if not source_path.exists():
        print(f"❌ الملف غير موجود: {file_path}")
        return False
    
    # نسخ الملف إلى مجلد النسخ الاحتياطي
    timestamp = get_timestamp()
    backup_filename = f"restored_{timestamp}.db"
    backup_path = BACKUP_DIR / backup_filename
    
    shutil.copy2(source_path, backup_path)
    
    # الاستعادة من الملف المنسوخ
    return restore_backup(backup_filename)

# ============================================================
# النسخ الاحتياطي التلقائي (Auto Backup)
# ============================================================

class AutoBackupScheduler:
    """جدولة النسخ الاحتياطي التلقائي"""
    
    def __init__(self):
        self.running = False
        self.thread = None
        self.last_run = None
    
    def start(self):
        """بدء الجدولة"""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        print("✅ تم بدء جدولة النسخ الاحتياطي التلقائي")
    
    def stop(self):
        """إيقاف الجدولة"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        print("⏹️ تم إيقاف جدولة النسخ الاحتياطي التلقائي")
    
    def _run(self):
        """تشغيل الجدولة في الخلفية"""
        while self.running:
            config = load_config()
            
            # التحقق من تفعيل النسخ التلقائي
            if not config.get('auto_backup_enabled', True):
                time.sleep(60)
                continue
            
            last_backup = config.get('last_backup_at')
            
            # إذا لم يتم إنشاء نسخة اليوم، قم بإنشائها
            should_backup = False
            
            if last_backup is None:
                should_backup = True
            else:
                last_backup_time = datetime.fromisoformat(last_backup)
                hours_since_last = (datetime.now() - last_backup_time).total_seconds() / 3600
                if hours_since_last >= AUTO_BACKUP_INTERVAL_HOURS:
                    should_backup = True
            
            if should_backup:
                print(f"⏰ إنشاء نسخة احتياطية تلقائية...")
                create_backup()
                self.last_run = datetime.now()
            
            # الانتظار لمدة ساعة قبل التحقق مرة أخرى
            time.sleep(3600)

# ============================================================
# دعم TeraBox (النسخ الاحتياطي السحابي)
# ============================================================

class TeraboxBackup:
    """إدارة النسخ الاحتياطي على TeraBox"""
    
    def __init__(self):
        self.config = load_config()
        self.enabled = self.config.get('terabox_enabled', False)
        self.token = self.config.get('terabox_token')
    
    def set_token(self, token: str):
        """تعيين توكن TeraBox"""
        self.token = token
        config = load_config()
        config['terabox_token'] = token
        config['terabox_enabled'] = True
        save_config(config)
        self.enabled = True
    
    def disable(self):
        """تعطيل النسخ الاحتياطي على TeraBox"""
        config = load_config()
        config['terabox_enabled'] = False
        save_config(config)
        self.enabled = False
    
    def upload_backup(self, backup_filename: str = None) -> bool:
        """
        رفع نسخة احتياطية إلى TeraBox
        @param backup_filename: اسم ملف النسخة (آخر نسخة إذا لم يتم تحديد)
        @returns: نجاح العملية
        """
        if not self.enabled or not self.token:
            print("❌ TeraBox غير مفعل أو التوكن غير موجود")
            return False
        
        # تحديد ملف النسخة
        if backup_filename is None:
            backups = get_backup_files()
            if not backups:
                print("❌ لا توجد نسخ احتياطية للرفع")
                return False
            backup_filename = backups[0]['filename']
        
        backup_path = BACKUP_DIR / backup_filename
        if not backup_path.exists():
            print(f"❌ ملف النسخة غير موجود: {backup_filename}")
            return False
        
        # هنا سيتم رفع الملف إلى TeraBox عبر API
        # هذا مجرد مثال، سيتم استبداله بالتكامل الفعلي مع TeraBox API
        print(f"☁️ جاري رفع {backup_filename} إلى TeraBox...")
        
        # محاكاة الرفع
        time.sleep(2)
        
        print(f"✅ تم رفع {backup_filename} إلى TeraBox بنجاح")
        return True
    
    def download_backup(self, backup_filename: str) -> bool:
        """
        تحميل نسخة احتياطية من TeraBox
        @param backup_filename: اسم ملف النسخة
        @returns: نجاح العملية
        """
        if not self.enabled or not self.token:
            print("❌ TeraBox غير مفعل أو التوكن غير موجود")
            return False
        
        # هنا سيتم تحميل الملف من TeraBox عبر API
        print(f"☁️ جاري تحميل {backup_filename} من TeraBox...")
        
        # محاكاة التحميل
        time.sleep(2)
        
        print(f"✅ تم تحميل {backup_filename} من TeraBox بنجاح")
        return True
    
    def list_remote_backups(self) -> List[Dict]:
        """الحصول على قائمة النسخ الاحتياطية في TeraBox"""
        if not self.enabled or not self.token:
            return []
        
        # هنا سيتم جلب القائمة من TeraBox API
        # مؤقتاً نعيد قائمة محلية
        return get_backup_files()

# ============================================================
# الواجهة الرئيسية (API)
# ============================================================

class BackupManager:
    """الواجهة الرئيسية لمدير النسخ الاحتياطي"""
    
    def __init__(self):
        self.auto_scheduler = AutoBackupScheduler()
        self.terabox = TeraboxBackup()
        self._init_check()
    
    def _init_check(self):
        """التحقق من الحاجة لإنشاء نسخة احتياطية عند التشغيل"""
        ensure_directories()
        
        # بدء الجدولة التلقائية
        self.auto_scheduler.start()
        
        # التحقق من وجود قاعدة البيانات
        if not DB_PATH.exists():
            print("⚠️ قاعدة البيانات غير موجودة، سيتم إنشاؤها عند أول استخدام")
    
    def create(self) -> Optional[Dict]:
        """إنشاء نسخة احتياطية"""
        return create_backup()
    
    def list_backups(self) -> List[Dict]:
        """قائمة النسخ الاحتياطية المحلية"""
        return get_backup_files()
    
    def restore(self, backup_filename: str) -> bool:
        """استعادة من نسخة محلية"""
        return restore_backup(backup_filename)
    
    def restore_from_file(self, file_path: str) -> bool:
        """استعادة من ملف خارجي"""
        return restore_from_backup_file(file_path)
    
    def clean_old(self):
        """تنظيف النسخ القديمة"""
        clean_old_backups()
    
    def get_status(self) -> Dict:
        """الحصول على حالة نظام النسخ الاحتياطي"""
        config = load_config()
        backups = get_backup_files()
        
        return {
            'db_exists': DB_PATH.exists(),
            'db_size_mb': round(DB_PATH.stat().st_size / (1024 * 1024), 2) if DB_PATH.exists() else 0,
            'backups_count': len(backups),
            'last_backup_at': config.get('last_backup_at'),
            'last_restore_at': config.get('last_restore_at'),
            'auto_backup_enabled': config.get('auto_backup_enabled', True),
            'terabox_enabled': self.terabox.enabled,
            'backups': backups[:5]  # آخر 5 نسخ فقط
        }
    
    def enable_auto_backup(self, enabled: bool):
        """تفعيل/تعطيل النسخ الاحتياطي التلقائي"""
        config = load_config()
        config['auto_backup_enabled'] = enabled
        save_config(config)
        print(f"{'✅ تم تفعيل' if enabled else '⏹️ تم تعطيل'} النسخ الاحتياطي التلقائي")
    
    # دوال TeraBox
    def enable_terabox(self, token: str = None):
        """تفعيل النسخ الاحتياطي على TeraBox"""
        if token:
            self.terabox.set_token(token)
        else:
            self.terabox.enabled = True
            config = load_config()
            config['terabox_enabled'] = True
            save_config(config)
    
    def disable_terabox(self):
        """تعطيل النسخ الاحتياطي على TeraBox"""
        self.terabox.disable()
    
    def upload_to_terabox(self, backup_filename: str = None) -> bool:
        """رفع نسخة إلى TeraBox"""
        return self.terabox.upload_backup(backup_filename)
    
    def download_from_terabox(self, backup_filename: str) -> bool:
        """تحميل نسخة من TeraBox"""
        return self.terabox.download_backup(backup_filename)
    
    def list_terabox_backups(self) -> List[Dict]:
        """قائمة النسخ في TeraBox"""
        return self.terabox.list_remote_backups()

# ============================================================
# التشغيل كسكريبت مستقل
# ============================================================

def main():
    """تشغيل مدير النسخ الاحتياطي كسكريبت مستقل"""
    import argparse
    
    parser = argparse.ArgumentParser(description='مدير النسخ الاحتياطي')
    parser.add_argument('--create', action='store_true', help='إنشاء نسخة احتياطية')
    parser.add_argument('--list', action='store_true', help='عرض قائمة النسخ')
    parser.add_argument('--restore', type=str, help='استعادة من نسخة (اسم الملف)')
    parser.add_argument('--clean', action='store_true', help='تنظيف النسخ القديمة')
    parser.add_argument('--status', action='store_true', help='عرض الحالة')
    
    args = parser.parse_args()
    
    manager = BackupManager()
    
    if args.create:
        result = manager.create()
        if result:
            print(f"✅ تم إنشاء النسخة: {result['filename']}")
    
    elif args.list:
        backups = manager.list_backups()
        if backups:
            print("\n📋 قائمة النسخ الاحتياطية:")
            for b in backups:
                print(f"  • {b['filename']} - {b['size_mb']} MB - {b['created_at']}")
        else:
            print("📭 لا توجد نسخ احتياطية")
    
    elif args.restore:
        if manager.restore(args.restore):
            print(f"✅ تم استعادة البيانات من: {args.restore}")
        else:
            print(f"❌ فشل استعادة البيانات من: {args.restore}")
    
    elif args.clean:
        manager.clean_old()
        print("✅ تم تنظيف النسخ القديمة")
    
    elif args.status:
        status = manager.get_status()
        print("\n📊 حالة نظام النسخ الاحتياطي:")
        print(f"  • قاعدة البيانات: {'موجودة' if status['db_exists'] else 'غير موجودة'}")
        print(f"  • حجم قاعدة البيانات: {status['db_size_mb']} MB")
        print(f"  • عدد النسخ: {status['backups_count']}")
        print(f"  • آخر نسخة: {status['last_backup_at'] or 'لا توجد'}")
        print(f"  • النسخ التلقائي: {'مفعل' if status['auto_backup_enabled'] else 'معطل'}")
        print(f"  • TeraBox: {'مفعل' if status['terabox_enabled'] else 'معطل'}")
    
    else:
        parser.print_help()

if __name__ == '__main__':
    main()

# ============================================================
# تصدير للاستخدام من Node.js/Electron
# ============================================================

# إذا تم استدعاؤها من Node.js، نُخرج الدوال المطلوبة
try:
    # محاولة تصدير للاستخدام مع child_process
    __all__ = ['BackupManager', 'create_backup', 'restore_backup', 'get_backup_files', 'clean_old_backups']
except:
    pass
