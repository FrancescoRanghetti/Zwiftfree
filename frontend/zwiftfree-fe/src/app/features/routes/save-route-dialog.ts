import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { applyFieldErrors, problemMessage } from '../../core/api/problem';
import { RoutesApi } from '../../core/api/roads.api';
import { PlanProfile, PlanResult, RouteDetail } from '../../core/api/roads.models';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldError } from '../../shared/field-error';

export interface SaveRouteData {
  plan: PlanResult;
  profile: PlanProfile;
  suggestedName: string;
}

@Component({
  selector: 'app-save-route-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    TranslatePipe,
    FieldError,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ 'routes.saveTitle' | t }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content class="content">
        <mat-form-field appearance="outline">
          <mat-label>{{ 'routes.name' | t }}</mat-label>
          <input matInput formControlName="name" maxlength="80" />
          <mat-error><app-field-error [control]="form.controls.name" /></mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>{{ 'routes.description' | t }}</mat-label>
          <textarea matInput formControlName="description" rows="3" maxlength="1000"></textarea>
        </mat-form-field>
        <mat-slide-toggle formControlName="isPublic">{{ 'routes.public' | t }}</mat-slide-toggle>
        @if (error(); as msg) {
          <p class="error" role="alert">{{ msg }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button type="submit" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: min(420px, 80vw);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class SaveRouteDialog {
  private readonly data = inject<SaveRouteData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SaveRouteDialog, RouteDetail>);
  private readonly api = inject(RoutesApi);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data.suggestedName, [Validators.required, Validators.maxLength(80)]],
    description: [''],
    isPublic: [false],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      const saved = await firstValueFrom(
        this.api.create({
          name: v.name.trim(),
          description: v.description.trim() || undefined,
          isPublic: v.isPublic,
          edgeIds: this.data.plan.edgeIds,
          directions: this.data.plan.directions,
          profile: this.data.profile,
        }),
      );
      this.ref.close(saved);
    } catch (e) {
      if (!applyFieldErrors(e, this.form)) this.error.set(problemMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
