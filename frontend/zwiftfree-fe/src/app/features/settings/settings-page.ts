import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DatePipe } from '@angular/common';
import { applyFieldErrors, problemMessage } from '../../core/api/problem';
import { Me, RideView, SceneQuality, Units } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { MeService } from '../../core/auth/me.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DeviceManager } from '../../devices/device-manager.service';
import { KnownDevicesService } from '../../devices/known-devices.service';
import { FieldError } from '../../shared/field-error';

@Component({
  selector: 'app-settings-page',
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatListModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatSliderModule,
    TranslatePipe,
    FieldError,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly auth = inject(AuthService);
  private readonly meService = inject(MeService);
  private readonly snack = inject(MatSnackBar);
  private readonly i18n = inject(I18nService);
  protected readonly knownDevices = inject(KnownDevicesService);
  protected readonly deviceManager = inject(DeviceManager);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    /** Percent in the UI, 0–1 on the API. */
    trainerDifficultyPct: [100, [Validators.required, Validators.min(0), Validators.max(100)]],
    units: ['metric' as Units, Validators.required],
    audioEnabled: [true],
    peeBreakEnabled: [true],
    peeBreakAfterSeconds: [20, [Validators.required, Validators.min(5), Validators.max(600)]],
    crashEventsEnabled: [true],
    cornerAssistEnabled: [false],
    rideView: ['MAP_2D' as RideView, Validators.required],
    headBobEnabled: [{ value: false, disabled: true }],
    sceneQuality: ['MEDIUM' as SceneQuality, Validators.required],
  });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.form.controls.peeBreakEnabled.valueChanges.pipe(takeUntilDestroyed()).subscribe((on) => {
      const c = this.form.controls.peeBreakAfterSeconds;
      if (on) c.enable({ emitEvent: false });
      else c.disable({ emitEvent: false });
    });
    this.form.controls.rideView.valueChanges.pipe(takeUntilDestroyed()).subscribe((view) => {
      const bob = this.form.controls.headBobEnabled;
      if (view === 'FIRST_PERSON') bob.enable({ emitEvent: false });
      else bob.disable({ emitEvent: false });
    });
    const me = this.auth.me();
    if (me) this.fill(me);
  }

  formatPct = (v: number) => `${v}%`;

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const me = this.auth.me();
    if (!me) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      let updated = await this.meService.updateSettings({
        trainerDifficulty: Math.round(v.trainerDifficultyPct) / 100,
        audioEnabled: v.audioEnabled,
        peeBreakEnabled: v.peeBreakEnabled,
        peeBreakAfterSeconds: v.peeBreakAfterSeconds,
        crashEventsEnabled: v.crashEventsEnabled,
        cornerAssistEnabled: v.cornerAssistEnabled,
        rideView: v.rideView,
        headBobEnabled: v.headBobEnabled,
        sceneQuality: v.sceneQuality,
      });
      if (v.units !== me.profile.units) updated = await this.meService.updateUnits(v.units);
      this.fill(updated);
      this.snack.open(this.i18n.t('settings.saved'), undefined, { duration: 3000 });
    } catch (e) {
      if (!applyFieldErrors(e, this.form)) this.error.set(problemMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  private fill(me: Me): void {
    const s = me.settings;
    this.form.reset({
      trainerDifficultyPct: Math.round(s.trainerDifficulty * 100),
      units: me.profile.units,
      audioEnabled: s.audioEnabled,
      peeBreakEnabled: s.peeBreakEnabled,
      peeBreakAfterSeconds: s.peeBreakAfterSeconds,
      crashEventsEnabled: s.crashEventsEnabled,
      cornerAssistEnabled: s.cornerAssistEnabled,
      rideView: s.rideView ?? 'MAP_2D',
      headBobEnabled: s.headBobEnabled ?? false,
      sceneQuality: s.sceneQuality ?? 'MEDIUM',
    });
  }
}
