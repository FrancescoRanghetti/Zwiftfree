import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RegisterPage } from './register-page';

describe('RegisterPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function fill(el: HTMLElement, name: string, value: string): void {
    const input = el.querySelector(`input[formcontrolname=${name}]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  it('requires a 10-character password and a matching confirmation', async () => {
    const fixture = TestBed.createComponent(RegisterPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'displayName', 'Mario');
    fill(el, 'email', 'mario@example.ch');
    fill(el, 'password', 'short');
    fill(el, 'confirmPassword', 'different');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Almeno 10 caratteri');
    expect(el.textContent).toContain('Le password non coincidono');
    TestBed.inject(HttpTestingController).expectNone('/api/auth/register');
  });

  it('maps backend field errors onto the form', async () => {
    const fixture = TestBed.createComponent(RegisterPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'displayName', 'Mario');
    fill(el, 'email', 'mario@example.ch');
    fill(el, 'password', 'long-enough-password');
    fill(el, 'confirmPassword', 'long-enough-password');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/register')
      .flush(
        { status: 400, detail: 'Dati non validi', errors: { email: 'Email non valida' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(el.textContent).toContain('Email non valida');
    });
  });

  it('shows the conflict message for an existing email', async () => {
    const fixture = TestBed.createComponent(RegisterPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'displayName', 'Mario');
    fill(el, 'email', 'mario@example.ch');
    fill(el, 'password', 'long-enough-password');
    fill(el, 'confirmPassword', 'long-enough-password');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/register')
      .flush(
        { status: 409, detail: 'Esiste già un account con questa email' },
        { status: 409, statusText: 'Conflict' },
      );
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(el.querySelector('[data-testid="register-error"]')?.textContent).toContain(
        'Esiste già un account',
      );
    });
  });
});
