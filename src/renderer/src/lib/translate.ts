/** Common translation targets offered in settings (display name → ISO code). */
export const LANGUAGE_CODES: Record<string, string> = {
  English: 'en',
  Arabic: 'ar',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Portuguese: 'pt',
  Russian: 'ru',
  Turkish: 'tr',
  Chinese: 'zh-CN',
  Japanese: 'ja',
  Korean: 'ko',
  Hindi: 'hi',
  Urdu: 'ur',
  Persian: 'fa',
  Dutch: 'nl',
  Swedish: 'sv',
  Polish: 'pl',
  Ukrainian: 'uk',
  Indonesian: 'id'
}

/** Language display names, in offering order (for the settings dropdown). */
export const LANGUAGES = Object.keys(LANGUAGE_CODES)

/** Map a display name (e.g. "Arabic") to its translate code (e.g. "ar"). */
export function langCode(name: string | undefined): string {
  if (!name) return 'en'
  return LANGUAGE_CODES[name] ?? name.toLowerCase()
}
