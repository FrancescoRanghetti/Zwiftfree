import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TurnChoice } from '../../physics/junctions';

/** Turn arrows shown before a junction in free ride; each arrow points the way the road leaves. */
@Component({
  selector: 'app-turn-arrows',
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (choices().length) {
      <div
        class="arrows"
        role="radiogroup"
        [attr.aria-label]="'ride.chooseTurn' | t"
        data-testid="turn-arrows"
      >
        @for (c of choices(); track $index) {
          <button
            type="button"
            role="radio"
            class="arrow"
            [class.selected]="$index === selected()"
            [attr.aria-checked]="$index === selected()"
            [attr.aria-label]="
              ('turn.' + c.maneuver | t) + (c.edge.name ? ' · ' + c.edge.name : '')
            "
            [title]="c.edge.name ?? ''"
            (click)="choose.emit($index)"
          >
            <mat-icon
              fontSet="material-symbols-outlined"
              [style.transform]="'rotate(' + c.turn + 'deg)'"
              >arrow_upward</mat-icon
            >
            <span class="name">{{ c.edge.name || ('turn.' + c.maneuver | t) }}</span>
          </button>
        }
      </div>
      <p class="hint">{{ 'ride.turnKeys' | t }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
    }
    .arrows {
      display: flex;
      gap: 8px;
      pointer-events: auto;
    }
    .arrow {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      width: 92px;
      padding: 8px 4px;
      border-radius: 12px;
      border: 2px solid transparent;
      background: rgba(18, 18, 18, 0.8);
      color: #fff;
      cursor: pointer;
    }
    .arrow mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      transition: transform 0.2s;
    }
    .arrow.selected {
      border-color: #00e5ff;
      background: rgba(0, 96, 110, 0.85);
    }
    .name {
      font-size: 0.7rem;
      max-width: 88px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      margin: 4px 0 0;
      font-size: 0.72rem;
      color: #fff;
      text-shadow: 0 1px 2px #000;
    }
  `,
})
export class TurnArrows {
  readonly choices = input.required<TurnChoice[]>();
  readonly selected = input.required<number>();
  readonly choose = output<number>();
}
