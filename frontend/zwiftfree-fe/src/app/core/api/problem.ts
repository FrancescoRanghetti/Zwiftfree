import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup } from '@angular/forms';

/** RFC 9457 body returned by the backend. */
export interface Problem {
  status?: number;
  detail?: string;
  errors?: Record<string, string>;
}

/** User-facing message for any HTTP error (Italian, like the backend's messages). */
export function problemMessage(err: unknown, fallback = 'Si è verificato un errore'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Server non raggiungibile. Controlla la connessione.';
    const body = err.error as Problem | null;
    if (body && typeof body === 'object' && body.detail) return body.detail;
  }
  return fallback;
}

/** Copies backend field errors onto matching form controls as `{ server: message }`. */
export function applyFieldErrors(err: unknown, form: FormGroup): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  const errors = (err.error as Problem | null)?.errors;
  if (!errors) return false;
  let applied = false;
  for (const [path, message] of Object.entries(errors)) {
    const control: AbstractControl | null = form.get(path);
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: message });
      control.markAsTouched();
      applied = true;
    }
  }
  return applied;
}
