import { Injectable } from '@angular/core';
import { TokenResponse } from './auth.models';

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
  /** epoch ms */
  accessExpiresAt: number;
}

export const STORAGE_KEY = 'zf.auth';
const EMPTY: StoredTokens = { accessToken: null, refreshToken: null, accessExpiresAt: 0 };

/**
 * Tokens live in localStorage so every tab shares one session: tabs pick up each other's rotated tokens instead of
 * replaying an old refresh token (which the backend treats as theft).
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  read(): StoredTokens {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<StoredTokens>) } : EMPTY;
    } catch {
      return EMPTY;
    }
  }

  write(t: TokenResponse, now = Date.now()): StoredTokens {
    const stored: StoredTokens = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      accessExpiresAt: now + t.expiresIn * 1000,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      /* private mode: session lasts for this tab only */
    }
    return stored;
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
