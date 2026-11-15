import { Injectable, computed, signal } from '@angular/core';
import { IT, PartialTranslations } from './translations.it';

export type Lang = 'it' | 'de';
export const SUPPORTED_LANGS: readonly Lang[] = ['it'];

/** Italian ships with the app; other languages are loaded when chosen. */
const LOADERS: Record<Exclude<Lang, 'it'>, () => Promise<PartialTranslations>> = {
  de: () => import('./translations.de').then((m) => m.DE),
};

/**
 * Minimal signal-based runtime i18n. Lookup by dotted key, `{name}` interpolation, Italian fallback (also while
 * another language is loading).
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>('it');
  private readonly loaded = signal<Partial<Record<Lang, PartialTranslations>>>({ it: IT });
  private readonly dict = computed(() => this.loaded()[this.lang()] ?? IT);

  async setLang(lang: Lang): Promise<void> {
    if (!this.loaded()[lang] && lang !== 'it') {
      const dict = await LOADERS[lang]();
      this.loaded.update((d) => ({ ...d, [lang]: dict }));
    }
    this.lang.set(lang);
    document.documentElement.lang = lang;
  }

  t(key: string, params?: Record<string, string | number>): string {
    const raw = lookup(this.dict(), key) ?? lookup(IT, key) ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in params ? String(params[name]) : m,
    );
  }
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}
