import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Group validator: `confirmKey` must equal `key`; the error is set on the confirm control. */
export function matchValidator(key: string, confirmKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(key);
    const b = group.get(confirmKey);
    if (!a || !b) return null;
    const mismatch = !!b.value && a.value !== b.value;
    const errors = { ...(b.errors ?? {}) };
    if (mismatch) errors['mismatch'] = true;
    else delete errors['mismatch'];
    b.setErrors(Object.keys(errors).length ? errors : null);
    return null;
  };
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
