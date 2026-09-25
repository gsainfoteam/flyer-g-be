import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { z } from 'zod';
import { AppException } from '../errors/app.exception.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { CursorQueryDto } from './cursor-query.dto.js';
import { toPage } from './page.js';

const cursorSchema = z.tuple([z.iso.datetime(), z.string()]);

describe('cursor', () => {
  it('encode한 값을 그대로 decode한다', () => {
    const value = ['2026-07-29T06:30:00.000Z', 'sub_01'];
    expect(decodeCursor(encodeCursor(value), cursorSchema)).toEqual(value);
  });

  it.each([
    ['base64가 아닌 문자열', '!!!'],
    ['JSON이 아닌 값', Buffer.from('not json').toString('base64url')],
    ['스키마와 다른 값', encodeCursor({ offset: 20 })],
  ])('%s이면 400 INVALID_REQUEST', (_, cursor) => {
    try {
      decodeCursor(cursor, cursorSchema);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(400);
      expect((error as AppException).fields).toHaveProperty('cursor');
    }
  });
});

describe('toPage', () => {
  const serverTime = new Date('2026-07-29T06:30:00.000Z');
  const rows = [1, 2, 3].map((n) => ({ id: `sub_${n}`, n }));
  const options = {
    totalCount: 3,
    serverTime,
    cursorOf: (row: { id: string; n: number }) => [row.n, row.id],
    map: (row: { id: string }) => ({ id: row.id }),
  };

  it('limit보다 하나 더 있으면 잘라내고 마지막 항목으로 cursor를 만든다', () => {
    const page = toPage(rows, { ...options, limit: 2 });

    expect(page.items).toEqual([{ id: 'sub_1' }, { id: 'sub_2' }]);
    expect(page.nextCursor).toBe(encodeCursor([2, 'sub_2']));
    expect(page.totalCount).toBe(3);
    expect(page.serverTime).toBe('2026-07-29T06:30:00.000Z');
  });

  it('마지막 페이지면 nextCursor가 null', () => {
    expect(toPage(rows, { ...options, limit: 3 }).nextCursor).toBeNull();
    expect(toPage([], { ...options, limit: 10 })).toMatchObject({
      items: [],
      nextCursor: null,
    });
  });
});

describe('CursorQueryDto', () => {
  async function parse(query: Record<string, string>) {
    const dto = plainToInstance(CursorQueryDto, query);
    return { dto, errors: await validate(dto) };
  }

  it('빈 cursor와 빈 limit은 없는 것으로 보고 기본값을 쓴다', async () => {
    const { dto, errors } = await parse({ cursor: '', limit: '' });
    expect(errors).toHaveLength(0);
    expect(dto.cursor).toBeUndefined();
    expect(dto.limit).toBe(10);
  });

  it('limit 문자열을 숫자로 바꾼다', async () => {
    const { dto, errors } = await parse({ limit: '20' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(20);
  });

  it.each(['0', '101', '1.5', 'abc'])('limit=%s는 거절한다', async (limit) => {
    const { errors } = await parse({ limit });
    expect(errors.map((e) => e.property)).toEqual(['limit']);
  });
});
