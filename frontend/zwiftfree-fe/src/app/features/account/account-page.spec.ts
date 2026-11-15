import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ME } from '../../core/auth/testing';
import { AccountPage } from './account-page';

describe('AccountPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setMe(ME);
  });

  it('pre-fills the profile and updates the avatar preview live', async () => {
    const fixture = TestBed.createComponent(AccountPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('input[formcontrolname=ftpWatts]') as HTMLInputElement).value).toBe(
      '250',
    );
    const jersey = el.querySelector('[data-testid="jersey-color"]') as HTMLInputElement;
    jersey.value = '#00aa55';
    jersey.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelector('app-avatar-preview path[fill="#00aa55"]')).not.toBeNull();
  });

  it('saves the profile with the edited values', async () => {
    const fixture = TestBed.createComponent(AccountPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const weight = el.querySelector('input[formcontrolname=weightKg]') as HTMLInputElement;
    weight.value = '68.5';
    weight.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[data-testid="save-profile"]')!.click();
    const req = TestBed.inject(HttpTestingController).expectOne('/api/me/profile');
    expect(req.request.body).toMatchObject({ displayName: 'Mario', weightKg: 68.5, ftpWatts: 250 });
    req.flush({ ...ME, profile: { ...ME.profile, weightKg: 68.5 } });
  });

  it('blocks out-of-range values', async () => {
    const fixture = TestBed.createComponent(AccountPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const ftp = el.querySelector('input[formcontrolname=ftpWatts]') as HTMLInputElement;
    ftp.value = '900';
    ftp.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('[data-testid="save-profile"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Valore massimo 600');
    TestBed.inject(HttpTestingController).expectNone('/api/me/profile');
  });
});
