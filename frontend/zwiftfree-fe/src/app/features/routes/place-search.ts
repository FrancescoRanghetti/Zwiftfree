import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { RoadsApi } from '../../core/api/roads.api';
import { Place } from '../../core/api/roads.models';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Autocomplete over the Ticino localities table. */
@Component({
  selector: 'app-place-search',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field appearance="outline" class="search" subscriptSizing="dynamic">
      <mat-icon matPrefix fontSet="material-symbols-outlined">search</mat-icon>
      <input
        matInput
        [formControl]="query"
        [matAutocomplete]="auto"
        [placeholder]="'routes.searchPlace' | t"
        data-testid="place-search"
      />
      <mat-autocomplete
        #auto="matAutocomplete"
        [displayWith]="display"
        (optionSelected)="pick($event.option.value)"
      >
        @for (p of results(); track p.id) {
          <mat-option [value]="p">
            {{ p.name }} <small class="kind">{{ 'places.' + p.kind | t }}</small>
          </mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    .search {
      width: 100%;
    }
    .kind {
      opacity: 0.6;
      margin-left: 6px;
    }
  `,
})
export class PlaceSearch {
  readonly selected = output<Place>();
  private readonly api = inject(RoadsApi);

  protected readonly query = new FormControl<string | Place>('', { nonNullable: true });
  protected readonly results = toSignal(
    this.query.valueChanges.pipe(
      startWith(''),
      map((v) => (typeof v === 'string' ? v.trim() : v.name)),
      debounceTime(200),
      distinctUntilChanged(),
      switchMap((q) => (q.length < 2 ? of([]) : this.api.places(q).pipe(catchError(() => of([]))))),
    ),
    { initialValue: [] as Place[] },
  );

  protected display = (p: Place | string | null) => (typeof p === 'string' ? p : (p?.name ?? ''));

  protected pick(p: Place): void {
    this.selected.emit(p);
  }
}
