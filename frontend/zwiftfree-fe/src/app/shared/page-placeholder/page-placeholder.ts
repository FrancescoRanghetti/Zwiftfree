import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Temporary page body for features not yet implemented. */
@Component({
  selector: 'app-page-placeholder',
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>
        <mat-icon fontSet="material-symbols-outlined">{{ icon() }}</mat-icon>
        {{ titleKey() | t }}
      </h1>
      <p>{{ 'placeholder.comingSoon' | t }}</p>
    </section>
  `,
  styles: `
    h1 {
      display: flex;
      align-items: center;
      gap: 12px;
      font: var(--mat-sys-headline-medium);
    }
    p {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class PagePlaceholder {
  readonly icon = input.required<string>();
  readonly titleKey = input.required<string>();
}
