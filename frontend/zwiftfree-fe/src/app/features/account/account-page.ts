import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom, map, startWith } from 'rxjs';
import { applyFieldErrors, problemMessage } from '../../core/api/problem';
import { AvatarConfig, Me } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { MeService } from '../../core/auth/me.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AvatarPreview } from '../../avatar/avatar-preview';
import { FieldError } from '../../shared/field-error';
import { PASSWORD_MAX, PASSWORD_MIN, matchValidator } from '../../shared/validators';
import { DeleteAccountDialog } from './delete-account-dialog';

const HEX = /^#[0-9a-fA-F]{6}$/;

@Component({
  selector: 'app-account-page',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    FieldError,
    AvatarPreview,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-page.html',
  styleUrl: './account-page.scss',
})
export class AccountPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly meService = inject(MeService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly i18n = inject(I18nService);

  protected readonly me = this.auth.me;

  protected readonly profileForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(60)]],
    weightKg: [75, [Validators.required, Validators.min(30), Validators.max(250)]],
    heightCm: [null as number | null, [Validators.min(100), Validators.max(250)]],
    birthYear: [null as number | null, [Validators.min(1900), Validators.max(2100)]],
    ftpWatts: [200, [Validators.required, Validators.min(50), Validators.max(600)]],
    maxHr: [null as number | null, [Validators.min(100), Validators.max(240)]],
    restingHr: [null as number | null, [Validators.min(25), Validators.max(120)]],
    bikeWeightKg: [8, [Validators.required, Validators.min(3), Validators.max(30)]],
    avatar: this.fb.group({
      jerseyColor: ['#ff9800', [Validators.required, Validators.pattern(HEX)]],
      helmetColor: ['#fafafa', [Validators.required, Validators.pattern(HEX)]],
      bikeColor: ['#263238', [Validators.required, Validators.pattern(HEX)]],
    }),
  });

  protected readonly passwordForm = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: [
        '',
        [
          Validators.required,
          Validators.minLength(PASSWORD_MIN),
          Validators.maxLength(PASSWORD_MAX),
        ],
      ],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchValidator('newPassword', 'confirmPassword') },
  );

  protected readonly avatar = toSignal(
    this.profileForm.controls.avatar.valueChanges.pipe(
      startWith(this.profileForm.controls.avatar.getRawValue()),
      map(() => this.profileForm.controls.avatar.getRawValue() as AvatarConfig),
    ),
    { requireSync: true },
  );

  protected readonly savingProfile = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly profileError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);

  constructor() {
    const me = this.me();
    if (me) this.fill(me);
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    const me = this.me();
    if (!me) return;
    this.savingProfile.set(true);
    this.profileError.set(null);
    try {
      const v = this.profileForm.getRawValue();
      const updated = await this.meService.updateProfile({
        ...me.profile,
        ...v,
        displayName: v.displayName.trim(),
      });
      this.fill(updated);
      this.toast('account.profileSaved');
    } catch (e) {
      if (!applyFieldErrors(e, this.profileForm)) this.profileError.set(problemMessage(e));
    } finally {
      this.savingProfile.set(false);
    }
  }

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.savingPassword.set(true);
    this.passwordError.set(null);
    try {
      const { currentPassword, newPassword } = this.passwordForm.getRawValue();
      await this.meService.changePassword(currentPassword, newPassword);
      this.passwordForm.reset();
      this.toast('account.passwordChanged');
    } catch (e) {
      if (!applyFieldErrors(e, this.passwordForm)) this.passwordError.set(problemMessage(e));
    } finally {
      this.savingPassword.set(false);
    }
  }

  async deleteAccount(): Promise<void> {
    const ref = this.dialog.open<DeleteAccountDialog, void, string>(DeleteAccountDialog, {
      width: '420px',
    });
    const password = await firstValueFrom(ref.afterClosed());
    if (!password) return;
    try {
      await this.meService.deleteAccount(password);
      await this.auth.logout();
      this.toast('account.deleted');
    } catch (e) {
      this.snack.open(problemMessage(e), 'OK', { duration: 5000 });
    }
  }

  private fill(me: Me): void {
    const p = me.profile;
    this.profileForm.reset({
      displayName: me.displayName,
      weightKg: p.weightKg,
      heightCm: p.heightCm,
      birthYear: p.birthYear,
      ftpWatts: p.ftpWatts,
      maxHr: p.maxHr,
      restingHr: p.restingHr,
      bikeWeightKg: p.bikeWeightKg,
      avatar: { ...p.avatar },
    });
  }

  private toast(key: string): void {
    this.snack.open(this.i18n.t(key), undefined, { duration: 3000 });
  }
}
