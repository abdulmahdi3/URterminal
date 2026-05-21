import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ar from './locales/ar'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' }
] as const

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
