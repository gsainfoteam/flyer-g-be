import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB_CONNECTION, type Database } from '../db/index.js';
import { categories } from '../db/schema.js';

@Injectable()
export class CategoriesService {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  /** 신청 폼에 노출할 카테고리. 숨긴 카테고리는 뺀다. */
  findActive(): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder), asc(categories.id));
  }
}
