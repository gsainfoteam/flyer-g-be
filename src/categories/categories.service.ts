import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
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

  /** 신청에 쓸 수 있는 카테고리인가 (숨긴 카테고리는 새 신청에 쓸 수 없다) */
  async isActive(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.isActive, true)));
    return row !== undefined;
  }
}
