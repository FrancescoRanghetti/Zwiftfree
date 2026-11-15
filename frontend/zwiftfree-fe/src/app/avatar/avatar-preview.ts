import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AvatarConfig } from '../core/auth/auth.models';

/**
 * Zwiftfree's own stylized rider, side view. Static preview used by the account page; the animated version (pedalling
 * with cadence, pee break, crash) builds on the same drawing in milestone 6.
 */
@Component({
  selector: 'app-avatar-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 200 140" role="img" [attr.aria-label]="label()">
      <!-- road -->
      <rect x="0" y="122" width="200" height="4" rx="2" fill="#5d5d5d" />
      <!-- wheels -->
      <g fill="none" stroke="#1a1a1a" stroke-width="5">
        <circle cx="52" cy="98" r="24" />
        <circle cx="148" cy="98" r="24" />
      </g>
      <g fill="none" stroke="#9e9e9e" stroke-width="1">
        <circle cx="52" cy="98" r="20" />
        <circle cx="148" cy="98" r="20" />
      </g>
      <!-- frame -->
      <g
        fill="none"
        [attr.stroke]="config().bikeColor"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M52 98 L88 98 L78 62 Z" />
        <path d="M88 98 L134 64 L78 62" />
        <path d="M134 64 L148 98" />
        <path d="M134 64 L131 54" />
        <path d="M78 62 L76 54" />
      </g>
      <!-- saddle & bars -->
      <path d="M66 52 L86 52" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" />
      <path
        d="M127 52 L140 52 Q146 54 142 62"
        fill="none"
        stroke="#1a1a1a"
        stroke-width="4"
        stroke-linecap="round"
      />
      <!-- crank -->
      <circle cx="88" cy="98" r="6" fill="#1a1a1a" />
      <!-- legs (shorts + skin) -->
      <g stroke-linecap="round" fill="none">
        <path d="M78 50 L100 74 L90 108" stroke="#212121" stroke-width="10" />
        <path d="M78 50 L94 80 L84 88" stroke="#2b2b2b" stroke-width="9" />
        <path d="M100 74 L90 108" stroke="#e0ac7e" stroke-width="7" />
      </g>
      <!-- torso (jersey) -->
      <path d="M74 52 Q92 22 122 30 L126 40 Q100 36 86 58 Z" [attr.fill]="config().jerseyColor" />
      <!-- arm -->
      <path
        d="M118 34 L136 50"
        stroke="#e0ac7e"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <path
        d="M114 32 L124 41"
        [attr.stroke]="config().jerseyColor"
        stroke-width="8"
        stroke-linecap="round"
        fill="none"
      />
      <!-- head + helmet -->
      <circle cx="132" cy="24" r="9" fill="#e0ac7e" />
      <path d="M121 22 Q126 8 142 14 Q146 18 144 22 Z" [attr.fill]="config().helmetColor" />
      <path d="M140 25 L145 25" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: auto;
    }
  `,
})
export class AvatarPreview {
  readonly config = input.required<AvatarConfig>();
  readonly label = input('Avatar');
}
