import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { ME, TOKENS } from './testing';
import { STORAGE_KEY, TokenStorage } from './token-storage';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function flushLogin(): Promise<void> {
    const done = auth.login('mario@example.ch', 'password-123');
    http.expectOne('/api/auth/login').flush(TOKENS);
    await Promise.resolve();
    const me = http.expectOne('/api/me');
    expect(me.request.headers.get('Authorization')).toBe('Bearer access-1');
    me.flush(ME);
    await done;
  }

  it('logs in, stores the tokens and loads the profile', async () => {
    await flushLogin();
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.me()?.displayName).toBe('Mario');
    expect(TestBed.inject(TokenStorage).read().refreshToken).toBe('refresh-1');
  });

  it('restores the session on init', async () => {
    TestBed.inject(TokenStorage).write(TOKENS);
    const done = auth.init();
    http.expectOne('/api/me').flush(ME);
    await done;
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('init without stored tokens does nothing', async () => {
    await auth.init();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('init clears storage when the session cannot be restored', async () => {
    TestBed.inject(TokenStorage).write(TOKENS);
    const done = auth.init();
    http.expectOne('/api/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(auth.isLoggedIn()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('logs out: clears local state, revokes the refresh token, goes to /login', async () => {
    await flushLogin();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const done = auth.logout();
    await Promise.resolve();
    expect(auth.isLoggedIn()).toBe(false);
    await Promise.resolve();
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.body).toEqual({ refreshToken: 'refresh-1' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(nav).toHaveBeenCalledWith('/login');
  });

  it('refresh is single-flight: concurrent callers share one request', async () => {
    TestBed.inject(TokenStorage).write(TOKENS);
    const a = firstValueFrom(auth.refreshAccessToken('access-1'));
    const b = firstValueFrom(auth.refreshAccessToken('access-1'));
    await Promise.resolve();
    http
      .expectOne('/api/auth/refresh')
      .flush({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 });
    await Promise.all([a, b]);
    expect(auth.accessToken()).toBe('access-2');
    expect(TestBed.inject(TokenStorage).read().refreshToken).toBe('refresh-2');
  });

  it('reuses a token another tab already refreshed instead of rotating again', async () => {
    TestBed.inject(TokenStorage).write({ ...TOKENS, accessToken: 'from-other-tab' });
    await firstValueFrom(auth.refreshAccessToken('access-1'));
    http.expectNone('/api/auth/refresh');
    expect(auth.accessToken()).toBe('from-other-tab');
  });
});
