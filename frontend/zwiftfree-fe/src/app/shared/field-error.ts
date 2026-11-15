import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { I18nService } from '../core/i18n/i18n.service';

/** Italian message for the first error of a control; follows the control's `events` stream. */
@Component({
  selector: 'app-field-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ message() }}`,
})
export class FieldError {
  readonly control = input.required<AbstractControl | null>();
  private readonly i18n = inject(I18nService);
  private readonly version = signal(0);

  constructor() {
    effect((onCleanup) => {
      const control = this.control();
      if (!control) return;
      const sub = control.events.subscribe(() => this.version.update((v) => v + 1));
      onCleanup(() => sub.unsubscribe());
    });
  }

  protected readonly message = computed(() => {
    this.version();
    this.i18n.lang();
    return this.describe();
  });

  private describe(): string {
    const errors = this.control()?.errors;
    if (!errors) return '';
    if (errors['server']) return errors['server'] as string;
    if (errors['required']) return this.i18n.t('validation.required');
    if (errors['email']) return this.i18n.t('validation.email');
    if (errors['minlength'])
      return this.i18n.t('validation.minLength', {
        n: (errors['minlength'] as { requiredLength: number }).requiredLength,
      });
    if (errors['maxlength'])
      return this.i18n.t('validation.maxLength', {
        n: (errors['maxlength'] as { requiredLength: number }).requiredLength,
      });
    if (errors['min'])
      return this.i18n.t('validation.min', { n: (errors['min'] as { min: number }).min });
    if (errors['max'])
      return this.i18n.t('validation.max', { n: (errors['max'] as { max: number }).max });
    if (errors['pattern']) return this.i18n.t('validation.pattern');
    if (errors['mismatch']) return this.i18n.t('validation.passwordMismatch');
    return this.i18n.t('validation.invalid');
  }
}
