import { liveInputSchema } from './live-schema.js';

const issuesOf = (value: unknown) =>
  (liveInputSchema.safeParse(value).error?.issues ?? []).map((issue) => [
    issue.path.join('.'),
    issue.message,
  ]);

describe('liveInputSchema', () => {
  it('보내지 않은 부분은 null이다', () => {
    expect(liveInputSchema.parse({})).toEqual({ main: null, alert: null });
  });

  it('SHOW는 submissionId와 programId 중 하나만', () => {
    expect(issuesOf({ main: { action: 'SHOW' } })).toEqual([
      ['main.submissionId', 'submissionId와 programId 중 하나만 보내세요.'],
    ]);
    expect(
      issuesOf({
        main: {
          action: 'SHOW',
          submissionId: '8d2f4a1e-3c5b-4e21-9a0c-1d8e5f6b2c34',
          programId: 'prg_dday',
        },
      }),
    ).toEqual([
      ['main.submissionId', 'submissionId와 programId 중 하나만 보내세요.'],
    ]);
    expect(
      issuesOf({ main: { action: 'SHOW', programId: 'prg_dday' } }),
    ).toEqual([]);
  });

  it('GAME은 until이 필수이고 게임 종류로 설정을 검증한다', () => {
    expect(
      issuesOf({
        main: { action: 'GAME', game: { type: 'CLICK_BATTLE', rounds: 11 } },
      }),
    ).toEqual([
      ['main.game.rounds', '판 수는 10 이하여야 합니다.'],
      ['main.until', '끝 시각은 시간대가 있는 ISO 시각이어야 합니다.'],
    ]);
    expect(
      issuesOf({
        main: {
          action: 'GAME',
          game: { type: 'QUIZ_BATTLE' },
          until: '2026-11-02T04:00:00Z',
        },
      }),
    ).toEqual([['main.game.type', '게임 종류가 올바르지 않습니다.']]);
  });

  it('알림 문구는 앞뒤 공백을 지운 뒤 1~80자', () => {
    expect(issuesOf({ alert: { text: '   ' } })).toEqual([
      ['alert.text', '알림 문구를 입력하세요.'],
    ]);
    expect(liveInputSchema.parse({ alert: { text: ' 단수 ' } }).alert).toEqual({
      text: '단수',
    });
    expect(issuesOf({ alert: { text: 'x'.repeat(81) } })).toEqual([
      ['alert.text', '알림 문구는 80자 이하여야 합니다.'],
    ]);
  });
});
