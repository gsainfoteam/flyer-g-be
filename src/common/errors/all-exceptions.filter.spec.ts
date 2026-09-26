import {
  BadGatewayException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppException } from './app.exception.js';
import { toErrorResponse } from './all-exceptions.filter.js';
import { ErrorCode } from './error-code.js';

const REQUEST_ID = 'req_test';

describe('toErrorResponse', () => {
  it('AppException은 code와 fields를 그대로 싣는다', () => {
    const exception = new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.VALIDATION_FAILED,
      '입력값이 올바르지 않습니다.',
      { endAt: '종료 시각은 시작 시각보다 뒤여야 합니다.' },
    );

    expect(toErrorResponse(exception, REQUEST_ID)).toEqual({
      status: 422,
      body: {
        code: 'VALIDATION_FAILED',
        message: '입력값이 올바르지 않습니다.',
        requestId: REQUEST_ID,
        fields: { endAt: '종료 시각은 시작 시각보다 뒤여야 합니다.' },
      },
    });
  });

  it('fields가 없으면 키 자체를 넣지 않는다', () => {
    const { body } = toErrorResponse(
      new AppException(409, ErrorCode.CONFLICT, 'Conflict'),
      REQUEST_ID,
    );
    expect(body).not.toHaveProperty('fields');
  });

  it.each([
    [new UnauthorizedException('Invalid access token'), 401, 'UNAUTHENTICATED'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new BadGatewayException('IdP down'), 502, 'SERVER_ERROR'],
  ])(
    'HttpException은 상태코드별 기본 code를 쓴다 (%#)',
    (exception, status, code) => {
      const result = toErrorResponse(exception, REQUEST_ID);
      expect(result.status).toBe(status);
      expect(result.body.code).toBe(code);
      expect(result.body.requestId).toBe(REQUEST_ID);
    },
  );

  it('HttpException의 메시지를 꺼낸다', () => {
    const { body } = toErrorResponse(
      new UnauthorizedException('Access token expired'),
      REQUEST_ID,
    );
    expect(body.message).toBe('Access token expired');
  });

  it('body-parser 오류(http-errors)는 해당 4xx로 바꾼다', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
    });
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });

    expect(toErrorResponse(parseError, REQUEST_ID)).toMatchObject({
      status: 400,
      body: { code: 'INVALID_REQUEST' },
    });
    expect(toErrorResponse(tooLarge, REQUEST_ID)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('알 수 없는 오류는 500이고 내부 메시지를 숨긴다', () => {
    const { status, body } = toErrorResponse(
      new Error('connection refused: postgres://secret@db'),
      REQUEST_ID,
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'SERVER_ERROR',
      message: 'Internal server error',
      requestId: REQUEST_ID,
    });
  });

  it('expose가 없는 오류는 status가 있어도 500으로 본다', () => {
    const internal = Object.assign(new Error('boom'), { status: 400 });
    expect(toErrorResponse(internal, REQUEST_ID).status).toBe(500);
  });
});
