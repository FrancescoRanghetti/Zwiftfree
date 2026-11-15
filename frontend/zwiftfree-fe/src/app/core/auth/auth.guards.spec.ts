import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { authGuard, guestGuard } from './auth.guards';
import { AuthService } from './auth.service';
import { ME } from './testing';

describe('auth guards', () => {
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/stats' } as RouterStateSnapshot;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
  });

  it('authGuard redirects anonymous users to /login with returnUrl', () => {
    const result = TestBed.runInInjectionContext(() => authGuard(route, state)) as UrlTree;
    expect(result.toString()).toBe('/login?returnUrl=%2Fstats');
  });

  it('authGuard lets logged-in users through', () => {
    TestBed.inject(AuthService).setMe(ME);
    expect(TestBed.runInInjectionContext(() => authGuard(route, state))).toBe(true);
  });

  it('guestGuard sends logged-in users home', () => {
    TestBed.inject(AuthService).setMe(ME);
    const result = TestBed.runInInjectionContext(() => guestGuard(route, state)) as UrlTree;
    expect(result.toString()).toBe('/home');
  });
});
