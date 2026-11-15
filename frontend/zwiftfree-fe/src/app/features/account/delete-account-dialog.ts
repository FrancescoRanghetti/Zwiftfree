import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldError } from '../../shared/field-error';

/** Asks for the password; closes with it, or with undefined when cancelled. */
@Component({
  selector: 'app-delete-account-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
    FieldError,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'account.deleteTitle' | t }}</h2>
    <mat-dialog-content>
      <p>{{ 'account.deleteWarning' | t }}</p>
      <mat-form-field appearance="outline" class="full">
        <mat-label>{{ 'auth.password' | t }}</mat-label>
        <input
          matInput
          type="password"
          [formControl]="password"
          autocomplete="current-password"
          (keydown.enter)="confirm()"
        />
        <mat-error><app-field-error [control]="password" /></mat-error>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button class="danger" (click)="confirm()" data-testid="confirm-delete">
        {{ 'account.deleteConfirm' | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
    }
    .danger {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
})
export class DeleteAccountDialog {
  private readonly ref = inject(MatDialogRef<DeleteAccountDialog, string>);
  protected readonly password = inject(FormBuilder).nonNullable.control('', Validators.required);

  confirm(): void {
    if (this.password.invalid) {
      this.password.markAsTouched();
      return;
    }
    this.ref.close(this.password.value);
  }
}
