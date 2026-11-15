import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SIM_MAX_POWER, SIM_STEP_W, SimulatorTrainer } from '../../devices/simulator-trainer';

/** Simulator controls: power slider 0–600 W and ±10 W buttons (also ↑/↓ on the keyboard). */
@Component({
  selector: 'app-sim-panel',
  imports: [DecimalPipe, MatButtonModule, MatIconModule, MatSliderModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <strong>{{ 'sim.title' | t }}</strong>
      <span class="grade">{{ 'sim.trainerGrade' | t }}: {{ grade() | number: '1.1-1' }}%</span>
    </div>
    <div class="row">
      <button
        mat-icon-button
        type="button"
        [attr.aria-label]="'sim.less' | t"
        (click)="trainer().nudge(-step)"
      >
        <mat-icon fontSet="material-symbols-outlined">remove</mat-icon>
      </button>
      <mat-slider min="0" [max]="max" [step]="step" discrete class="slider">
        <input
          matSliderThumb
          [value]="trainer().targetPower()"
          (valueChange)="trainer().setPower($event)"
          [attr.aria-label]="'sim.power' | t"
          data-testid="sim-power"
        />
      </mat-slider>
      <button
        mat-icon-button
        type="button"
        [attr.aria-label]="'sim.more' | t"
        (click)="trainer().nudge(step)"
        data-testid="sim-more"
      >
        <mat-icon fontSet="material-symbols-outlined">add</mat-icon>
      </button>
    </div>
    <div class="watts">{{ trainer().targetPower() }} W</div>
    <div class="presets">
      @for (w of presets; track w) {
        <button mat-stroked-button type="button" (click)="trainer().setPower(w)">{{ w }}</button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: rgba(18, 18, 18, 0.82);
      color: #fff;
      border-radius: 12px;
      padding: 8px 10px;
      width: 260px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 0.8rem;
    }
    .grade {
      color: #bdbdbd;
    }
    .row {
      display: flex;
      align-items: center;
    }
    .slider {
      flex: 1;
    }
    .watts {
      text-align: center;
      font-size: 1.2rem;
      font-weight: 600;
    }
    .presets {
      display: flex;
      gap: 4px;
      justify-content: center;
    }
    .presets button {
      min-width: 0;
      padding: 0 8px;
    }
    @media (max-width: 700px) {
      :host {
        width: auto;
        padding: 4px 8px;
      }
      .presets {
        display: none;
      }
      .watts {
        font-size: 1rem;
      }
    }
  `,
})
export class SimPanel {
  readonly trainer = input.required<SimulatorTrainer>();
  readonly grade = input(0);
  protected readonly max = SIM_MAX_POWER;
  protected readonly step = SIM_STEP_W;
  protected readonly presets = [0, 150, 200, 250, 300];
}
