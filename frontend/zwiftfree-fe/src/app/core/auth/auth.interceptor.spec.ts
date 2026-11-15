import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { ME, TOKENS } from './testing';
import { TokenStorage } from './token-storage';

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.acceptTokens(TOKENS);
  });

  afterEach(() => http.verify());

  it('adds the bearer token to API calls but not to auth calls or other origins', () => {
    client.get('/api/me').subscribe();
    client.post('/api/auth/login', {}).subscribe();
    client.get('https://wmts.geo.admin.ch/tile.png').subscribe();
    expect(http.expectOne('/api/me').request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(http.expectOne('/api/auth/login').request.headers.has('Authorization')).toBe(false);
    expect(
      http.expectOne('https://wmts.geo.admin.ch/tile.png').request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const result = firstValueFrom(client.get<typeof ME>('/api/me'));
    http.expectOne('/api/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    http
      .expectOne('/api/auth/refresh')
      .flush({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 });
    await vi.waitFor(() => {
      const retry = http.expectOne('/api/me');
      expect(retry.request.headers.get('Authorization')).toBe('Bearer access-2');
      retry.flush(ME);
    });
    expect((await result).email).toBe(ME.email);
  });

  it('expires the session when the refresh fails', async () => {
    auth.setMe(ME);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const result = firstValueFrom(client.get('/api/me'));
    http.expectOne('/api/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await Promise.resolve();
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(auth.isLoggedIn()).toBe(false);
    expect(TestBed.inject(TokenStorage).read().refreshToken).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('passes other errors through untouched', async () => {
    const result = firstValueFrom(client.get('/api/me'));
    http.expectOne('/api/me').flush(null, { status: 500, statusText: 'Server Error' });
    await expect(result).rejects.toMatchObject({ status: 500 });
    http.expectNone('/api/auth/refresh');
  });
});
