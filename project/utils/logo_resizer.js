// =====================================================================
// utils/logo_resizer.js
// أداة تغيير حجم اللوجو - دعم الصور بتنسيقات مختلفة
// المرجع: PROJECT_CONTEXT.txt
// المهام:
// 1. تغيير حجم الصور (اللوجو) بأبعاد مختلفة
// 2. دعم السحب والإفلات
// 3. حفظ الصورة بتنسيق base64
// 4. معاينة الصورة قبل الحفظ
// =====================================================================

class LogoResizer {
    constructor(options = {}) {
        // الإعدادات الافتراضية
        this.config = {
            maxWidth: 200,           // أقصى عرض للصورة
            maxHeight: 200,          // أقصى ارتفاع للصورة
            quality: 0.85,           // جودة الصورة (0-1)
            format: 'image/png',     // تنسيق الصورة الافتراضي
            maintainAspectRatio: true // الحفاظ على النسبة
        };
        
        // تحديث الإعدادات
        if (options) {
            this.config = { ...this.config, ...options };
        }
        
        // العناصر DOM
        this.dropZone = null;
        this.fileInput = null;
        this.previewImg = null;
        this.resultImg = null;
        
        // الحالة
        this.currentFile = null;
        this.currentImageData = null;
        
        // مستمعي الأحداث
        this.listeners = {
            'imageLoaded': [],
            'imageResized': [],
            'imageSaved': [],
            'error': []
        };
    }
    
    // ============================================================
    // التهيئة
    // ============================================================
    
    init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('[LogoResizer] الحاوية غير موجودة:', containerId);
            return false;
        }
        
        // إنشاء واجهة الأداة
        this.createUI(container);
        
        // ربط الأحداث
        this.bindEvents();
        
        console.log('[LogoResizer] تم تهيئة الأداة بنجاح');
        return true;
    }
    
    createUI(container) {
        container.innerHTML = `
            <div class="logo-resizer-container" style="direction: rtl; font-family: inherit;">
                <div class="logo-resizer-dropzone" id="logoDropZone" style="
                    border: 2px dashed #4F8EF7;
                    border-radius: 12px;
                    padding: 30px;
                    text-align: center;
                    cursor: pointer;
                    background: rgba(79, 142, 247, 0.05);
                    transition: all 0.3s ease;
                ">
                    <div style="font-size: 48px; margin-bottom: 10px;">📷</div>
                    <div style="margin-bottom: 10px;">اسحب الصورة هنا أو اضغط للاختيار</div>
                    <div style="font-size: 12px; color: #6B7280;">يدعم PNG, JPG, JPEG, GIF, SVG</div>
                    <input type="file" id="logoFileInput" accept="image/*" style="display: none;">
                </div>
                
                <div class="logo-resizer-preview" id="logoPreviewArea" style="
                    display: none;
                    margin-top: 20px;
                    padding: 20px;
                    background: #1A1D27;
                    border-radius: 12px;
                    border: 1px solid #2E3250;
                ">
                    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                        <div style="flex: 1; text-align: center;">
                            <h4 style="margin-bottom: 10px;">الصورة الأصلية</h4>
                            <img id="originalImage" style="max-width: 100%; max-height: 150px; border-radius: 8px;">
                            <div style="margin-top: 8px; font-size: 12px; color: #6B7280;">
                                <span id="originalSize"></span>
                            </div>
                        </div>
                        <div style="flex: 1; text-align: center;">
                            <h4 style="margin-bottom: 10px;">الصورة بعد التعديل</h4>
                            <img id="resizedImage" style="max-width: 100%; max-height: 150px; border-radius: 8px;">
                            <div style="margin-top: 8px; font-size: 12px; color: #6B7280;">
                                <span id="resizedSize"></span>
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <div style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center;">
                            <div>
                                <label style="font-size: 12px;">العرض (بكسل):</label>
                                <input type="number" id="widthInput" style="
                                    width: 80px;
                                    padding: 5px;
                                    background: #0F1117;
                                    border: 1px solid #2E3250;
                                    border-radius: 6px;
                                    color: #E8EBF4;
                                    margin-right: 5px;
                                ">
                            </div>
                            <div>
                                <label style="font-size: 12px;">الارتفاع (بكسل):</label>
                                <input type="number" id="heightInput" style="
                                    width: 80px;
                                    padding: 5px;
                                    background: #0F1117;
                                    border: 1px solid #2E3250;
                                    border-radius: 6px;
                                    color: #E8EBF4;
                                    margin-right: 5px;
                                ">
                            </div>
                            <div>
                                <label style="font-size: 12px;">الجودة:</label>
                                <input type="range" id="qualitySlider" min="0" max="100" value="85" style="width: 100px;">
                                <span id="qualityValue" style="font-size: 12px;">85%</span>
                            </div>
                            <div>
                                <label style="font-size: 12px;">
                                    <input type="checkbox" id="keepAspect" checked> الحفاظ على النسبة
                                </label>
                            </div>
                        </div>
                        
                        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
                            <button id="applyResizeBtn" style="
                                padding: 8px 20px;
                                background: #4F8EF7;
                                border: none;
                                border-radius: 8px;
                                color: white;
                                cursor: pointer;
                            ">تطبيق التغيير</button>
                            <button id="saveLogoBtn" style="
                                padding: 8px 20px;
                                background: #2DD4BF;
                                border: none;
                                border-radius: 8px;
                                color: #0F1117;
                                cursor: pointer;
                            ">💾 حفظ الصورة</button>
                            <button id="cancelLogoBtn" style="
                                padding: 8px 20px;
                                background: #2E3250;
                                border: none;
                                border-radius: 8px;
                                color: #E8EBF4;
                                cursor: pointer;
                            ">إلغاء</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // حفظ المراجع
        this.dropZone = document.getElementById('logoDropZone');
        this.fileInput = document.getElementById('logoFileInput');
        this.previewArea = document.getElementById('logoPreviewArea');
        this.originalImg = document.getElementById('originalImage');
        this.resizedImg = document.getElementById('resizedImage');
        this.widthInput = document.getElementById('widthInput');
        this.heightInput = document.getElementById('heightInput');
        this.qualitySlider = document.getElementById('qualitySlider');
        this.qualityValue = document.getElementById('qualityValue');
        this.keepAspect = document.getElementById('keepAspect');
        this.applyBtn = document.getElementById('applyResizeBtn');
        this.saveBtn = document.getElementById('saveLogoBtn');
        this.cancelBtn = document.getElementById('cancelLogoBtn');
        this.originalSize = document.getElementById('originalSize');
        this.resizedSize = document.getElementById('resizedSize');
    }
    
    bindEvents() {
        // سحب وإفلات
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.style.borderColor = '#2DD4BF';
            this.dropZone.style.background = 'rgba(46, 202, 171, 0.1)';
        });
        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.style.borderColor = '#4F8EF7';
            this.dropZone.style.background = 'rgba(79, 142, 247, 0.05)';
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.style.borderColor = '#4F8EF7';
            this.dropZone.style.background = 'rgba(79, 142, 247, 0.05)';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.loadImage(file);
            } else {
                this.emit('error', { message: 'الرجاء إفلات ملف صورة صالح' });
            }
        });
        
        // اختيار ملف
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.loadImage(e.target.files[0]);
            }
        });
        
        // جودة الصورة
        this.qualitySlider.addEventListener('input', (e) => {
            const value = e.target.value;
            this.qualityValue.textContent = value + '%';
            this.config.quality = value / 100;
            this.resizeImage();
        });
        
        // الحفاظ على النسبة
        this.keepAspect.addEventListener('change', () => {
            this.config.maintainAspectRatio = this.keepAspect.checked;
            if (this.currentImageData) {
                this.updateDimensionsFromImage();
            }
        });
        
        // تغيير الأبعاد
        this.widthInput.addEventListener('input', () => {
            if (this.config.maintainAspectRatio && this.currentImageData) {
                const ratio = this.currentImageData.height / this.currentImageData.width;
                this.heightInput.value = Math.round(this.widthInput.value * ratio);
            }
            this.resizeImage();
        });
        
        this.heightInput.addEventListener('input', () => {
            if (this.config.maintainAspectRatio && this.currentImageData) {
                const ratio = this.currentImageData.width / this.currentImageData.height;
                this.widthInput.value = Math.round(this.heightInput.value * ratio);
            }
            this.resizeImage();
        });
        
        // تطبيق التغيير
        this.applyBtn.addEventListener('click', () => this.resizeImage());
        
        // حفظ الصورة
        this.saveBtn.addEventListener('click', () => this.saveImage());
        
        // إلغاء
        this.cancelBtn.addEventListener('click', () => this.reset());
    }
    
    loadImage(file) {
        if (!file.type.startsWith('image/')) {
            this.emit('error', { message: 'الملف المحدد ليس صورة' });
            return;
        }
        
        this.currentFile = file;
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.currentImageData = {
                    file: file,
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    width: img.width,
                    height: img.height,
                    src: e.target.result,
                    image: img
                };
                
                // عرض الصورة الأصلية
                this.originalImg.src = e.target.result;
                this.originalSize.textContent = `${img.width} × ${img.height} | ${this.formatFileSize(file.size)}`;
                
                // تعيين الأبعاد الافتراضية
                this.updateDimensionsFromImage();
                
                // عرض منطقة المعاينة
                this.previewArea.style.display = 'block';
                
                // تغيير حجم الصورة
                this.resizeImage();
                
                this.emit('imageLoaded', this.currentImageData);
            };
            img.src = e.target.result;
        };
        
        reader.readAsDataURL(file);
    }
    
    updateDimensionsFromImage() {
        if (!this.currentImageData) return;
        
        let targetWidth = this.config.maxWidth;
        let targetHeight = this.config.maxHeight;
        
        if (this.config.maintainAspectRatio) {
            const ratio = this.currentImageData.height / this.currentImageData.width;
            if (targetWidth / targetHeight > ratio) {
                targetWidth = Math.round(targetHeight / ratio);
            } else {
                targetHeight = Math.round(targetWidth * ratio);
            }
        }
        
        this.widthInput.value = targetWidth;
        this.heightInput.value = targetHeight;
    }
    
    resizeImage() {
        if (!this.currentImageData) return;
        
        const width = parseInt(this.widthInput.value) || this.currentImageData.width;
        const height = parseInt(this.heightInput.value) || this.currentImageData.height;
        const quality = this.config.quality;
        
        // إنشاء canvas لتغيير الحجم
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // رسم الصورة بالأبعاد الجديدة
        ctx.drawImage(this.currentImageData.image, 0, 0, width, height);
        
        // تحويل إلى base64
        const format = this.currentImageData.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const resizedDataUrl = canvas.toDataURL(format, quality);
        
        // عرض الصورة بعد التعديل
        this.resizedImg.src = resizedDataUrl;
        
        // حساب حجم الصورة الجديدة
        const base64Length = resizedDataUrl.length - (resizedDataUrl.indexOf(',') + 1);
        const sizeInBytes = Math.round(base64Length * 0.75);
        this.resizedSize.textContent = `${width} × ${height} | ${this.formatFileSize(sizeInBytes)}`;
        
        this.resizedDataUrl = resizedDataUrl;
        this.resizedWidth = width;
        this.resizedHeight = height;
        
        this.emit('imageResized', {
            width, height,
            size: sizeInBytes,
            dataUrl: resizedDataUrl
        });
    }
    
    saveImage() {
        if (!this.resizedDataUrl) {
            this.emit('error', { message: 'لا توجد صورة للحفظ' });
            return;
        }
        
        // إرجاع الصورة كـ base64
        const result = {
            dataUrl: this.resizedDataUrl,
            width: this.resizedWidth,
            height: this.resizedHeight,
            format: this.currentImageData?.type || 'image/png',
            name: this.currentImageData?.name || 'logo.png'
        };
        
        this.emit('imageSaved', result);
        
        return result;
    }
    
    getImageData() {
        return this.resizedDataUrl || null;
    }
    
    reset() {
        this.currentFile = null;
        this.currentImageData = null;
        this.resizedDataUrl = null;
        this.fileInput.value = '';
        this.previewArea.style.display = 'none';
        this.originalImg.src = '';
        this.resizedImg.src = '';
    }
    
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    // ============================================================
    // إدارة الأحداث
    // ============================================================
    
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }
    
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
    
    // ============================================================
    // دوال مساعدة
    // ============================================================
    
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        if (this.currentImageData) {
            this.updateDimensionsFromImage();
            this.resizeImage();
        }
    }
    
    getConfig() {
        return { ...this.config };
    }
}

// ============================================================
// إنشاء نسخة واحدة من الأداة
// ============================================================
const logoResizer = new LogoResizer();

// تصدير للاستخدام
if (typeof module !== 'undefined' && module.exports) {
    module.exports = logoResizer;
    module.exports.LogoResizer = LogoResizer;
} else {
    window.logoResizer = logoResizer;
    window.LogoResizer = LogoResizer;
}
