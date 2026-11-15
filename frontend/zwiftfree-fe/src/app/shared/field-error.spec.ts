import { TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { FieldError } from './field-error';

describe('FieldError', () => {
  it('follows the control errors, including server ones', async () => {
    const control = new FormControl('', [Validators.required, Validators.minLength(10)]);
    const fixture = TestBed.createComponent(FieldError);
    fixture.componentRef.setInput('control', control);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toBe('Campo obbligatorio');

    control.setValue('short');
    await fixture.whenStable();
    expect(el.textContent).toBe('Almeno 10 caratteri');

    control.setValue('long enough value');
    await fixture.whenStable();
    expect(el.textContent).toBe('');

    control.setErrors({ server: 'Email già usata' });
    await fixture.whenStable();
    expect(el.textContent).toBe('Email già usata');
  });
});
