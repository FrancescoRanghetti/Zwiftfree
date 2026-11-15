import { Injectable, inject } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { I18nService } from './i18n.service';

/** Material paginator labels in the app language. */
@Injectable()
export class AppPaginatorIntl extends MatPaginatorIntl {
  private readonly i18n = inject(I18nService);

  override itemsPerPageLabel = this.i18n.t('paginator.itemsPerPage');
  override nextPageLabel = this.i18n.t('paginator.next');
  override previousPageLabel = this.i18n.t('paginator.previous');
  override firstPageLabel = this.i18n.t('paginator.first');
  override lastPageLabel = this.i18n.t('paginator.last');

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0)
      return this.i18n.t('paginator.range', { from: 0, to: 0, total: length });
    const from = page * pageSize + 1;
    const to = Math.min(length, (page + 1) * pageSize);
    return this.i18n.t('paginator.range', { from, to, total: length });
  };
}
