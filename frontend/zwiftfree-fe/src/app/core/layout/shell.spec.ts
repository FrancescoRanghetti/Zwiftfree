import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { ME } from '../auth/testing';
import { DeviceStatusService } from '../../devices/device-status.service';
import { NAV_ITEMS } from './nav-items';
import { Shell } from './shell';

describe('Shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();
  });

  it('renders the brand, every menu entry and the user name', async () => {
    TestBed.inject(AuthService).setMe(ME);
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.brand')?.textContent).toContain('Zwiftfree');
    const links = el.querySelectorAll('nav.nav a');
    expect(links.length).toBe(NAV_ITEMS.length);
    expect(links[2].textContent).toContain('Percorsi');
    expect(el.querySelector('[data-testid="user-name"]')?.textContent).toContain('Mario');
  });

  it('reflects device status changes in the top bar', async () => {
    const fixture = TestBed.createComponent(Shell);
    TestBed.inject(DeviceStatusService).simulatedTrainer.set(true);
    await fixture.whenStable();
    const indicators = (fixture.nativeElement as HTMLElement).querySelectorAll('.indicator');
    expect(indicators[0].classList).toContain('connected');
    expect(indicators[1].classList).toContain('disconnected');
    expect(indicators[0].getAttribute('aria-label')).toBe('Rullo: Collegato');
  });

  it('shows the map attribution', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('© swisstopo');
  });
});
