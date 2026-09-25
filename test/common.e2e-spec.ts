import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsNotEmpty, IsString } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { Idempotent } from '../src/common/idempotency/idempotent.decorator.js';

class EchoDto {
  @IsString()
  @IsNotEmpty({ message: '제목을 입력하세요.' })
  title: string;
}

let echoCalls = 0;

@Public()
@Controller('__test')
class TestController {
  @Post('echo')
  @Idempotent()
  async echo(@Body() dto: EchoDto) {
    echoCalls += 1;
    await sleep(100);
    return { call: echoCalls, title: dto.title };
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection refused: postgres://secret@db');
  }
}

describe('공통 규칙 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('오류 형식과 requestId', () => {
    it('없는 경로는 404 NOT_FOUND이고 헤더와 본문의 requestId가 같다', async () => {
      const res = await request(app.getHttpServer()).get('/nope').expect(404);

      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.body.requestId).toMatch(/^req_/);
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    it('성공 응답에도 x-request-id 헤더가 붙는다', async () => {
      const res = await request(app.getHttpServer()).get('/').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^req_/);
    });

    it('앞단이 준 x-request-id는 그대로 쓴다', async () => {
      const res = await request(app.getHttpServer())
        .get('/nope')
        .set('x-request-id', 'ingress-abc12345');
      expect(res.headers['x-request-id']).toBe('ingress-abc12345');
      expect(res.body.requestId).toBe('ingress-abc12345');
    });

    it('DTO 검증 실패는 422 VALIDATION_FAILED와 필드별 오류', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({})
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.fields)).toEqual(
        expect.arrayContaining(['code', 'redirectUri']),
      );
    });

    it('잘못된 JSON은 400 INVALID_REQUEST', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"code":')
        .expect(400);

      expect(res.body.code).toBe('INVALID_REQUEST');
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    it('인증 실패는 401 UNAUTHENTICATED', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/session')
        .expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('알 수 없는 오류는 500 SERVER_ERROR이고 내부 메시지를 숨긴다', async () => {
      const res = await request(app.getHttpServer())
        .get('/__test/boom')
        .expect(500);

      expect(res.body).toEqual({
        code: 'SERVER_ERROR',
        message: 'Internal server error',
        requestId: res.headers['x-request-id'],
      });
    });
  });

  describe('Idempotency-Key', () => {
    const echo = (key: string | undefined, title = '공연') => {
      const req = request(app.getHttpServer()).post('/__test/echo');
      if (key) {
        req.set('Idempotency-Key', key);
      }
      return req.send({ title });
    };

    beforeEach(() => {
      echoCalls = 0;
    });

    it('동시에 온 같은 key의 요청은 한 번만 처리하고 같은 응답을 준다', async () => {
      const key = randomUUID();
      const [a, b] = await Promise.all([echo(key), echo(key)]);

      expect(echoCalls).toBe(1);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body).toEqual(b.body);
      // 둘 중 하나는 저장된 응답을 받았다
      expect(
        [a, b].filter((res) => res.headers['idempotent-replayed'] === 'true'),
      ).toHaveLength(1);
    });

    it('완료 후 재시도는 저장된 응답을 준다', async () => {
      const key = randomUUID();
      const first = await echo(key).expect(201);
      const retry = await echo(key).expect(201);

      expect(echoCalls).toBe(1);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
    });

    it('같은 key로 다른 내용을 보내면 422 IDEMPOTENCY_KEY_REUSED', async () => {
      const key = randomUUID();
      await echo(key, '공연').expect(201);
      const res = await echo(key, '다른 공연').expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('검증 실패는 기억하지 않아 같은 key로 고쳐 보낼 수 없다 (내용이 다르므로 새 key)', async () => {
      const key = randomUUID();
      await echo(key, '').expect(422);
      // 같은 내용으로 재시도하면 다시 검증되어 같은 오류
      const retry = await echo(key, '').expect(422);
      expect(retry.body.code).toBe('VALIDATION_FAILED');
      expect(echoCalls).toBe(0);
    });

    it('헤더가 없으면 400', async () => {
      const res = await echo(undefined).expect(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
      expect(echoCalls).toBe(0);
    });
  });
});
