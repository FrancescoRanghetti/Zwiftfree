import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';

describe('I18nService', () => {
  let service: I18nService;

  beforeEach(() => {
    service = TestBed.inject(I18nService);
  });

  it('returns Italian strings by default', () => {
    expect(service.t('nav.routes')).toBe('Percorsi');
  });

  it('falls back to Italian when a German key is missing', async () => {
    await service.setLang('de');
    expect(service.t('nav.routes')).toBe('Strecken');
    expect(service.t('home.welcome')).toBe('Benvenuto su Zwiftfree');
  });

  it('returns the key itself when unknown', () => {
    expect(service.t('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates parameters', () => {
    expect(service.t('nav.home', { x: 1 })).toBe('Home');
    expect(service.t('unknown {n} {other}', { n: 3 })).toBe('unknown 3 {other}');
  });
});
