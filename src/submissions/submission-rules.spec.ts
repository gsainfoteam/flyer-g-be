import {
  canCancel,
  hasStartedPublishing,
  parseDetailUrl,
  validateSchedule,
} from './submission-rules.js';

const NOW = new Date('2026-07-29T06:30:00.000Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const kst = (iso: string) => new Date(`${iso}+09:00`);

describe('parseDetailUrl', () => {
  it('Ziggle 공지 주소에서 공지 ID를 뽑는다', () => {
    expect(parseDetailUrl('https://ziggle.gistory.me/notice/1041')).toEqual({
      url: 'https://ziggle.gistory.me/notice/1041',
      ziggleNoticeId: '1041',
    });
    expect(
      parseDetailUrl('https://ziggle.gistory.me/notice/1041/?ref=qr'),
    ).toMatchObject({ ziggleNoticeId: '1041' });
  });

  it('공지가 아닌 Ziggle 주소는 공지 ID가 없다', () => {
    expect(parseDetailUrl('https://ziggle.gistory.me/')).toEqual({
      url: 'https://ziggle.gistory.me/',
      ziggleNoticeId: null,
    });
  });

  it('호스트는 대소문자를 구분하지 않는다', () => {
    expect(parseDetailUrl('https://ZIGGLE.gistory.me/notice/7')).toMatchObject({
      url: 'https://ziggle.gistory.me/notice/7',
      ziggleNoticeId: '7',
    });
  });

  it.each([
    ['http 주소', 'http://ziggle.gistory.me/notice/1', 'https://'],
    [
      '허용하지 않은 호스트',
      'https://evil.example/notice/1',
      'ziggle.gistory.me',
    ],
    [
      '비슷한 하위 도메인',
      'https://ziggle.gistory.me.evil.example/',
      'ziggle.gistory.me',
    ],
    [
      '사용자 정보 포함',
      'https://a:b@ziggle.gistory.me/notice/1',
      'ziggle.gistory.me',
    ],
    [
      '포트 지정',
      'https://ziggle.gistory.me:8443/notice/1',
      'ziggle.gistory.me',
    ],
    ['주소가 아닌 값', 'not a url', '올바른 주소'],
  ])('%s는 거절한다', (_, raw, message) => {
    const result = parseDetailUrl(raw);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain(message);
  });
});

describe('validateSchedule', () => {
  it('규칙을 지키면 오류가 없다', () => {
    expect(validateSchedule(hours(48), hours(24 * 9), NOW)).toEqual({});
  });

  it('시작이 최소 사전 신청 시간(24시간)보다 이르면 startAt 오류', () => {
    expect(validateSchedule(hours(23), hours(100), NOW)).toEqual({
      startAt: '게시 시작은 신청 시각으로부터 24시간 이후여야 합니다.',
    });
    expect(validateSchedule(hours(24), hours(100), NOW)).toEqual({});
  });

  it('종료가 시작보다 앞서면 endAt 오류', () => {
    expect(validateSchedule(hours(48), hours(48), NOW)).toMatchObject({
      endAt: '종료 시각은 시작 시각보다 뒤여야 합니다.',
    });
  });

  it('종료가 이미 지났으면 endAt 오류', () => {
    expect(validateSchedule(hours(-48), hours(-1), NOW)).toMatchObject({
      endAt: '종료 시각이 이미 지났습니다.',
    });
  });

  it('최대 게시 기간(3개월, 서울 달력)을 넘으면 endAt 오류', () => {
    const start = kst('2026-11-30T09:00:00');
    expect(validateSchedule(start, kst('2027-02-28T09:00:00'), NOW)).toEqual(
      {},
    );
    expect(validateSchedule(start, kst('2027-02-28T09:00:01'), NOW)).toEqual({
      endAt: '게시 기간은 최대 3개월입니다.',
    });
  });
});

describe('canCancel / hasStartedPublishing', () => {
  it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const)(
    '%s는 언제든 취소할 수 있다',
    (status) => {
      expect(canCancel(status, hours(-10), NOW)).toBe(true);
    },
  );

  it('승인·예약 건은 시작 전에만 취소할 수 있다', () => {
    expect(canCancel('APPROVED', hours(1), NOW)).toBe(true);
    expect(canCancel('SCHEDULED', hours(1), NOW)).toBe(true);
    expect(canCancel('SCHEDULED', hours(-1), NOW)).toBe(false);
  });

  it.each(['PUBLISHED', 'ENDED', 'SUSPENDED', 'CANCELED', 'ARCHIVED'] as const)(
    '%s는 취소할 수 없다',
    (status) => {
      expect(canCancel(status, hours(10), NOW)).toBe(false);
    },
  );

  it('배치가 늦어 SCHEDULED로 남아 있어도 시작 시각이 지났으면 게시 중으로 본다', () => {
    expect(hasStartedPublishing('SCHEDULED', hours(-1), NOW)).toBe(true);
    expect(hasStartedPublishing('SCHEDULED', hours(1), NOW)).toBe(false);
    expect(hasStartedPublishing('PUBLISHED', hours(1), NOW)).toBe(true);
  });
});
