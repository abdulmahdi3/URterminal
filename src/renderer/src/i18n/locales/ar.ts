import type en from './en'

const ar: typeof en = {
  app: {
    title: 'يوريغانت تيرمينال'
  },
  toolbar: {
    addAi: 'لوحة ذكاء اصطناعي',
    addShell: 'طرفية',
    settings: 'الإعدادات',
    perf: 'الأداء',
    panes: '{{count}} لوحات'
  },
  pane: {
    empty: 'لوحة فارغة',
    chooseType: 'اختر نوع اللوحة',
    aiPane: 'لوحة ذكاء اصطناعي',
    shellPane: 'طرفية',
    close: 'إغلاق',
    split: 'تقسيم'
  },
  ai: {
    placeholder: 'أرسل رسالة…',
    send: 'إرسال',
    stop: 'إيقاف',
    model: 'النموذج',
    provider: 'المزود',
    noKey: 'لا يوجد مفتاح API للمزود {{provider}}. افتح الإعدادات لإضافة واحد.',
    thinking: 'جارٍ التوليد…'
  },
  settings: {
    title: 'الإعدادات',
    close: 'إغلاق',
    providers: 'مزودو الذكاء الاصطناعي',
    apiKey: 'مفتاح API',
    baseUrl: 'عنوان الخادم',
    save: 'حفظ',
    saved: 'تم الحفظ',
    test: 'اختبار',
    testing: 'جارٍ الاختبار…',
    testOk: 'المفتاح يعمل',
    testFail: 'فشل',
    keySet: 'تم ضبط المفتاح',
    keyNotSet: 'غير مضبوط',
    clear: 'مسح',
    telegram: 'تيليغرام',
    telegramToken: 'رمز البوت',
    telegramDefaultChat: 'معرّف المحادثة الافتراضي',
    telegramStatus: 'الحالة',
    telegramRunning: 'يعمل',
    telegramStopped: 'متوقف',
    restart: 'إعادة تشغيل البوت',
    defaults: 'الافتراضيات',
    defaultProvider: 'المزود الافتراضي',
    defaultModel: 'النموذج الافتراضي',
    appearance: 'المظهر',
    theme: 'السمة',
    dark: 'داكن',
    light: 'فاتح',
    language: 'اللغة'
  },
  telegram: {
    link: 'الربط بتيليغرام',
    linked: 'إعادة التوجيه إلى المحادثة {{chatId}}',
    unlink: 'إلغاء الربط',
    chatIdPrompt: 'معرّف محادثة تيليغرام لإعادة توجيه هذه اللوحة إليه:'
  },
  perf: {
    title: 'الأداء',
    ram: 'ذاكرة العملية الرئيسية',
    heap: 'الكومة',
    panes: 'اللوحات النشطة',
    streams: 'تدفقات/ثانية'
  }
}

export default ar
