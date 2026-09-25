import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { IdpService } from './idp.service.js';

const config = {
  get: (key: string) =>
    ({
      IDP_URL: 'https://idp.test/',
      IDP_CLIENT_ID: 'client',
      IDP_CLIENT_SECRET: 'secret',
    })[key],
} as unknown as ConfigService<Env, true>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('IdpService', () => {
  const service = new IdpService(config);
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe('exchangeCode', () => {
    it('Basic 인증과 form body로 token endpoint를 호출한다', async () => {
      fetchMock.mockResolvedValue(
        json(200, {
          access_token: 'at',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'rt',
        }),
      );

      const token = await service.exchangeCode('c', 'http://localhost/cb', 'v');

      expect(token.refresh_token).toBe('rt');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://idp.test/oauth/token');
      expect(init?.method).toBe('POST');
      expect((init!.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('client:secret').toString('base64')}`,
      );
      const body = init?.body as URLSearchParams;
      expect(Object.fromEntries(body)).toEqual({
        grant_type: 'authorization_code',
        code: 'c',
        redirect_uri: 'http://localhost/cb',
        code_verifier: 'v',
      });
    });

    it('IdP가 400(invalid_grant)을 주면 401', async () => {
      fetchMock.mockResolvedValue(json(400, { error: 'invalid_grant' }));
      await expect(
        service.exchangeCode('c', 'http://localhost/cb'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('IdP가 5xx면 502', async () => {
      fetchMock.mockResolvedValue(json(503, {}));
      await expect(
        service.exchangeCode('c', 'http://localhost/cb'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('네트워크 오류면 502', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(
        service.exchangeCode('c', 'http://localhost/cb'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('getUserInfo', () => {
    it('snake_case 응답을 camelCase로 바꾼다', async () => {
      fetchMock.mockResolvedValue(
        json(200, {
          sub: 'uuid-1',
          name: '홍길동',
          email: 'user@gm.gist.ac.kr',
          student_id: '20250001',
        }),
      );

      await expect(service.getUserInfo('at')).resolves.toEqual({
        uuid: 'uuid-1',
        name: '홍길동',
        email: 'user@gm.gist.ac.kr',
        studentId: '20250001',
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://idp.test/oauth/userinfo');
      expect((init!.headers as Record<string, string>).Authorization).toBe(
        'Bearer at',
      );
    });

    it('scope 누락으로 email이 없으면 502', async () => {
      fetchMock.mockResolvedValue(json(200, { sub: 'uuid-1', name: '홍길동' }));
      await expect(service.getUserInfo('at')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('IdP access token이 무효면 401', async () => {
      fetchMock.mockResolvedValue(json(401, {}));
      await expect(service.getUserInfo('at')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
