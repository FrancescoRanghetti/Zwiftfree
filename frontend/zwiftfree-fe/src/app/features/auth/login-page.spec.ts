import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginPage, safeReturnUrl } from './login-page';

describe('LoginPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function fill(el: HTMLElement, selector: string, value: string): void {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  it('shows Italian validation errors and does not call the API', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'input[type=email]', 'not-an-email');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Email non valida');
    expect(el.textContent).toContain('Campo obbligatorio');
    TestBed.inject(HttpTestingController).expectNone('/api/auth/login');
  });

  it('shows the server message on wrong credentials', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'input[type=email]', 'mario@example.ch');
    fill(el, 'input[formcontrolname=password]', 'wrong-password');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login')
      .flush(
        { status: 401, detail: 'Email o password non corretti' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(el.querySelector('[data-testid="login-error"]')?.textContent).toContain(
        'Email o password non corretti',
      );
    });
  });

  it('navigates to the return url after login', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('returnUrl', '/stats');
    await fixture.whenStable();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = fixture.nativeElement as HTMLElement;
    fill(el, 'input[type=email]', 'mario@example.ch');
    fill(el, 'input[formcontrolname=password]', 'correct-password');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/auth/login')
      .flush({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    await vi.waitFor(() => http.expectOne('/api/me').flush({ displayName: 'Mario' }));
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith('/stats'));
  });

  it('only accepts in-app return urls', () => {
    expect(safeReturnUrl('/routes')).toBe('/routes');
    expect(safeReturnUrl('//evil.example')).toBe('/home');
    expect(safeReturnUrl('https://evil.example')).toBe('/home');
    expect(safeReturnUrl('/login?x=1')).toBe('/home');
    expect(safeReturnUrl(undefined)).toBe('/home');
  });
});
