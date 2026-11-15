import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AvatarConfig } from '../core/auth/auth.models';

/** Any rider state (the avatar's, plus FINISHED from the ride engine). */
export type RiderPose =
  'IDLE' | 'RIDING' | 'COASTING' | 'PEE_BREAK' | 'CRASHED' | 'RECOVERING' | 'PAUSED' | 'FINISHED';

/**
 * Zwiftfree's own rider, animated with CSS: the legs pedal at the real cadence, the bike leans on a bush during the
 * pee break (only a head and a 💧 show behind the bush), slides on its side in a crash with stars and "ahia!", and
 * the rider climbs back on afterwards. Same drawing as the account page preview.
 */
@Component({
  selector: 'app-avatar-rider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 220 140"
      role="img"
      [attr.aria-label]="label()"
      [class]="'pose-' + pose()"
      [class.remount]="remounting()"
      [style.--leg-cycle]="cycle()"
    >
      <rect x="0" y="122" width="220" height="4" rx="2" fill="#5d5d5d" />
      @if (pose() === 'PEE_BREAK' || remounting()) {
        <g class="bush">
          <circle cx="186" cy="104" r="20" fill="#2e7d32" />
          <circle cx="204" cy="110" r="15" fill="#388e3c" />
          <circle cx="170" cy="112" r="13" fill="#43a047" />
        </g>
      }
      <g class="rig">
        <g class="bike">
          <g fill="none" stroke="#1a1a1a" stroke-width="5">
            <circle cx="52" cy="98" r="24" />
            <circle cx="148" cy="98" r="24" />
          </g>
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
          <path d="M66 52 L86 52" stroke="#1a1a1a" stroke-width="4" stroke-linecap="round" />
          <path
            d="M127 52 L140 52 Q146 54 142 62"
            fill="none"
            stroke="#1a1a1a"
            stroke-width="4"
            stroke-linecap="round"
          />
          <g class="crank">
            <path d="M88 86 L88 110" stroke="#424242" stroke-width="4" stroke-linecap="round" />
            <circle cx="88" cy="98" r="6" fill="#1a1a1a" />
          </g>
        </g>
        <g class="rider">
          <g class="leg back">
            <path d="M78 50 L98 76" stroke="#2b2b2b" stroke-width="9" stroke-linecap="round" />
            <g class="shin">
              <path d="M98 76 L90 106" stroke="#c9976b" stroke-width="6" stroke-linecap="round" />
            </g>
          </g>
          <path
            d="M74 52 Q92 22 122 30 L126 40 Q100 36 86 58 Z"
            [attr.fill]="config().jerseyColor"
          />
          <g class="leg front">
            <path d="M78 50 L100 74" stroke="#212121" stroke-width="10" stroke-linecap="round" />
            <g class="shin">
              <path d="M100 74 L90 108" stroke="#e0ac7e" stroke-width="7" stroke-linecap="round" />
            </g>
          </g>
          <path d="M118 34 L136 50" stroke="#e0ac7e" stroke-width="6" stroke-linecap="round" />
          <path
            d="M114 32 L124 41"
            [attr.stroke]="config().jerseyColor"
            stroke-width="8"
            stroke-linecap="round"
          />
          <circle cx="132" cy="24" r="9" fill="#e0ac7e" />
          <path d="M121 22 Q126 8 142 14 Q146 18 144 22 Z" [attr.fill]="config().helmetColor" />
        </g>
      </g>
      @switch (pose()) {
        @case ('PEE_BREAK') {
          <g class="peeker">
            <circle cx="190" cy="80" r="8" fill="#e0ac7e" />
            <path d="M180 78 Q184 66 198 71 Q201 75 199 78 Z" [attr.fill]="config().helmetColor" />
          </g>
          <g class="drop">
            <rect x="150" y="34" width="40" height="24" rx="10" fill="#ffffff" />
            <text x="170" y="51" text-anchor="middle" font-size="14">💧</text>
          </g>
        }
        @case ('CRASHED') {
          <g class="stars" fill="#ffd54f">
            <text x="70" y="60" font-size="16">✦</text>
            <text x="100" y="50" font-size="12">✦</text>
            <text x="128" y="62" font-size="14">✦</text>
          </g>
          <g class="ouch">
            <rect x="140" y="22" width="56" height="24" rx="10" fill="#ffffff" />
            <text
              x="168"
              y="39"
              text-anchor="middle"
              font-size="13"
              font-weight="700"
              fill="#c62828"
            >
              ahia!
            </text>
          </g>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .rig,
    .rider,
    .leg,
    .shin,
    .crank,
    .bike {
      transform-box: view-box;
    }
    .crank {
      transform-origin: 88px 98px;
    }
    .leg {
      transform-origin: 78px 50px;
    }
    .leg.front .shin {
      transform-origin: 100px 74px;
    }
    .leg.back .shin {
      transform-origin: 98px 76px;
    }
    .pose-RIDING .crank {
      animation: spin var(--leg-cycle, 0.67s) linear infinite;
    }
    .pose-RIDING .leg {
      animation: thigh var(--leg-cycle, 0.67s) ease-in-out infinite;
    }
    .pose-RIDING .leg .shin {
      animation: shin var(--leg-cycle, 0.67s) ease-in-out infinite;
    }
    .pose-RIDING .leg.back,
    .pose-RIDING .leg.back .shin {
      animation-delay: calc(var(--leg-cycle, 0.67s) / -2);
    }
    .pose-RIDING .rider {
      animation: bob calc(var(--leg-cycle, 0.67s) / 2) ease-in-out infinite;
    }
    .pose-PEE_BREAK .rider {
      opacity: 0;
    }
    .pose-PEE_BREAK .bike {
      transform: rotate(-10deg);
      transform-origin: 52px 122px;
    }
    .remount .rider {
      animation: climb-on 1.5s ease-out both;
    }
    .peeker {
      animation: peek 2s ease-in-out infinite;
    }
    .drop {
      animation: float 1.6s ease-in-out infinite alternate;
    }
    .pose-CRASHED .bike,
    .pose-RECOVERING .bike {
      transform-origin: 52px 122px;
    }
    .pose-CRASHED .bike {
      animation: skid 0.7s ease-out both;
    }
    .pose-CRASHED .rider,
    .pose-RECOVERING .rider {
      transform-origin: 110px 60px;
    }
    .pose-CRASHED .rider {
      animation: tumble 0.9s ease-out both;
    }
    .pose-RECOVERING .bike {
      transform: rotate(-12deg);
    }
    .pose-RECOVERING .rider {
      animation: get-up 2s ease-out both;
    }
    .stars {
      transform-origin: 100px 56px;
      transform-box: view-box;
      animation: spin 1.2s linear infinite;
    }
    .ouch {
      animation: float 0.6s ease-in-out infinite alternate;
    }
    .pose-PAUSED {
      filter: grayscale(1) opacity(0.6);
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes thigh {
      0%,
      100% {
        transform: rotate(-8deg);
      }
      50% {
        transform: rotate(14deg);
      }
    }
    @keyframes shin {
      0%,
      100% {
        transform: rotate(10deg);
      }
      50% {
        transform: rotate(-12deg);
      }
    }
    @keyframes bob {
      50% {
        transform: translateY(1.5px);
      }
    }
    @keyframes climb-on {
      from {
        transform: translate(70px, 8px);
        opacity: 0.3;
      }
    }
    @keyframes peek {
      50% {
        transform: translateY(-4px);
      }
    }
    @keyframes float {
      to {
        transform: translateY(-4px);
      }
    }
    /* The bike tips over and skids; the rider tumbles forward and ends up lying on the road. */
    @keyframes skid {
      to {
        transform: translateX(-10px) rotate(-12deg);
      }
    }
    @keyframes tumble {
      to {
        transform: translate(20px, 35px) rotate(450deg);
      }
    }
    @keyframes get-up {
      from {
        transform: translate(20px, 35px) rotate(90deg);
      }
      to {
        transform: translate(34px, 8px) rotate(8deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
      }
    }
  `,
})
export class AvatarRider {
  readonly config = input.required<AvatarConfig>();
  readonly pose = input<RiderPose>('IDLE');
  /** rpm; drives the leg animation */
  readonly cadence = input(90);
  /** Show the 1.5 s climb back on the bike after a pee break. */
  readonly remounting = input(false);
  readonly label = input('Avatar');

  /** One pedal revolution in seconds (clamped so a sensor glitch does not freeze or blur the legs). */
  protected readonly cycle = computed(() => {
    const rpm = Math.min(140, Math.max(40, this.cadence() || 90));
    return `${(60 / rpm).toFixed(3)}s`;
  });
}
