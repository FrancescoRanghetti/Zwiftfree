import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Me, ProfileUpdate, Settings, TokenResponse, Units } from './auth.models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class MeService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async updateProfile(update: ProfileUpdate): Promise<Me> {
    const me = await firstValueFrom(this.http.put<Me>('/api/me/profile', update));
    this.auth.setMe(me);
    return me;
  }

  /** Units live in the profile but are edited from the settings page. */
  async updateUnits(units: Units): Promise<Me> {
    const me = this.auth.me();
    if (!me) throw new Error('Not logged in');
    return this.updateProfile({ ...me.profile, displayName: me.displayName, units });
  }

  async updateSettings(settings: Settings): Promise<Me> {
    const me = await firstValueFrom(this.http.put<Me>('/api/me/settings', settings));
    this.auth.setMe(me);
    return me;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const t = await firstValueFrom(
      this.http.put<TokenResponse>('/api/me/password', { currentPassword, newPassword }),
    );
    this.auth.acceptTokens(t);
  }

  async deleteAccount(password: string): Promise<void> {
    await firstValueFrom(this.http.delete('/api/me', { body: { password } }));
  }
}
