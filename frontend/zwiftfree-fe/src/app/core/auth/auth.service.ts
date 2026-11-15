import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, from } from 'rxjs';
import { Me, TokenResponse } from './auth.models';
import { STORAGE_KEY, TokenStorage } from './token-storage';

const REFRESH_LOCK = 'zf-auth-refresh';
/** Treat the access token as expired slightly early to absorb clock skew. */
const EXPIRY_MARGIN_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly storage = inject(TokenStorage);

  private readonly _me = signal<Me | null>(null);
  private readonly _accessToken = signal<string | null>(null);
  private refreshInFlight: Promise<void> | null = null;

  readonly me = this._me.asReadonly();
  readonly accessToken = this._accessToken.asReadonly();
  readonly isLoggedIn = computed(() => this._me() !== null);

  constructor() {
    // Another tab logged in, rotated or logged out.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        const stored = this.storage.read();
        this._accessToken.set(stored.accessToken);
        if (!stored.refreshToken && this._me()) this.expireSession();
      });
    }
  }

  /** App start: restore the session from storage. Never rejects. */
  async init(): Promise<void> {
    const stored = this.storage.read();
    if (!stored.refreshToken) return;
    this._accessToken.set(stored.accessToken);
    try {
      await this.loadMe();
    } catch {
      this.clearLocal();
    }
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const t = await firstValueFrom(
      this.http.post<TokenResponse>('/api/auth/register', { email, password, displayName }),
    );
    this.acceptTokens(t);
    await this.loadMe();
  }

  async login(email: string, password: string): Promise<void> {
    const t = await firstValueFrom(
      this.http.post<TokenResponse>('/api/auth/login', { email, password }),
    );
    this.acceptTokens(t);
    await this.loadMe();
  }

  async logout(): Promise<void> {
    const { refreshToken } = this.storage.read();
    this.clearLocal();
    await this.router.navigateByUrl('/login');
    if (refreshToken) {
      try {
        await firstValueFrom(this.http.post('/api/auth/logout', { refreshToken }));
      } catch {
        /* the token expires anyway */
      }
    }
  }

  async loadMe(): Promise<Me> {
    const me = await firstValueFrom(this.http.get<Me>('/api/me'));
    this._me.set(me);
    return me;
  }

  setMe(me: Me): void {
    this._me.set(me);
  }

  /** Store a token pair issued by the backend (login, register, password change). */
  acceptTokens(t: TokenResponse): void {
    const stored = this.storage.write(t);
    this._accessToken.set(stored.accessToken);
  }

  hasRefreshToken(): boolean {
    return this.storage.read().refreshToken !== null;
  }

  /**
   * Gets a fresh access token after `failedToken` was rejected. Single-flight within the tab and serialized across
   * tabs with the Web Locks API: if another tab already rotated, its token is reused instead of refreshing again.
   */
  refreshAccessToken(failedToken: string | null): Observable<void> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.runExclusive(() => this.doRefresh(failedToken)).finally(() => {
        this.refreshInFlight = null;
      });
    }
    return from(this.refreshInFlight);
  }

  /**
   * An access token that is valid for a while yet, refreshing it first if needed — for connections that cannot go
   * through the HTTP interceptor (the live WebSocket). Null when there is no session.
   */
  async freshAccessToken(): Promise<string | null> {
    const stored = this.storage.read();
    if (stored.accessToken && stored.accessExpiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return stored.accessToken;
    }
    if (!stored.refreshToken) return null;
    try {
      await firstValueFrom(this.refreshAccessToken(stored.accessToken));
    } catch {
      return null;
    }
    return this.storage.read().accessToken;
  }

  /** Refresh failed for good: drop the session and, if one was active, go to the login page. */
  expireSession(): void {
    const hadSession = this._me() !== null;
    this.clearLocal();
    if (!hadSession) return; // e.g. during init(): route guards take care of redirecting
    void this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url, expired: 1 },
    });
  }

  private async doRefresh(failedToken: string | null): Promise<void> {
    const stored = this.storage.read();
    if (
      stored.accessToken &&
      stored.accessToken !== failedToken &&
      stored.accessExpiresAt - EXPIRY_MARGIN_MS > Date.now()
    ) {
      this._accessToken.set(stored.accessToken);
      return;
    }
    if (!stored.refreshToken) throw new Error('No refresh token');
    const t = await firstValueFrom(
      this.http.post<TokenResponse>('/api/auth/refresh', { refreshToken: stored.refreshToken }),
    );
    this.acceptTokens(t);
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request(REFRESH_LOCK, fn) : fn();
  }

  private clearLocal(): void {
    this.storage.clear();
    this._accessToken.set(null);
    this._me.set(null);
  }
}
