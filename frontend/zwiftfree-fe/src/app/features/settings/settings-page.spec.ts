import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ME } from '../../core/auth/testing';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setMe({
      ...ME,
      settings: { ...ME.settings, trainerDifficulty: 0.75, peeBreakEnabled: false },
    });
  });

  it('pre-fills from the profile and disables the pee-break delay when off', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('75%');
    const seconds = el.querySelector(
      'input[formcontrolname=peeBreakAfterSeconds]',
    ) as HTMLInputElement;
    expect(seconds.disabled).toBe(true);
    expect(el.querySelector('[data-testid="no-devices"]')).not.toBeNull();
    expect(
      el.querySelector<HTMLInputElement>('mat-radio-button[value="MAP_2D"] input')?.checked,
    ).toBe(true);
    expect(
      el.querySelector<HTMLInputElement>('mat-radio-button[value="MEDIUM"] input')?.checked,
    ).toBe(true);
    expect(
      el.querySelector<HTMLButtonElement>('[data-testid="head-bob-toggle"] button')?.disabled,
    ).toBe(true);
  });

  it('sends the difficulty as a 0–1 fraction', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="save-settings"]')!
      .click();
    const req = TestBed.inject(HttpTestingController).expectOne('/api/me/settings');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({
      trainerDifficulty: 0.75,
      peeBreakEnabled: false,
      rideView: 'MAP_2D',
      headBobEnabled: false,
      sceneQuality: 'MEDIUM',
    });
    req.flush(ME);
  });

  it('enables head movement only for first person and saves all 3D preferences', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLInputElement>('mat-radio-button[value="FIRST_PERSON"] input')!.click();
    await fixture.whenStable();
    const bob = el.querySelector<HTMLButtonElement>('[data-testid="head-bob-toggle"] button')!;
    expect(bob.disabled).toBe(false);
    bob.click();
    el.querySelector<HTMLInputElement>('mat-radio-button[value="HIGH"] input')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[data-testid="save-settings"]')!.click();
    const req = TestBed.inject(HttpTestingController).expectOne('/api/me/settings');
    expect(req.request.body).toMatchObject({
      rideView: 'FIRST_PERSON',
      headBobEnabled: true,
      sceneQuality: 'HIGH',
    });
    req.flush({
      ...ME,
      settings: {
        ...ME.settings,
        rideView: 'FIRST_PERSON',
        headBobEnabled: true,
        sceneQuality: 'HIGH',
      },
    });
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('mat-radio-button[value="THIRD_PERSON"] input')!.click();
    await fixture.whenStable();
    expect(bob.disabled).toBe(true);
  });
});
