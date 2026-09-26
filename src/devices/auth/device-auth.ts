import {
  applyDecorators,
  createParamDecorator,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiHeader, ApiSecurity } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.js';
import { DEVICE_TOKEN_AUTH } from '../../config/swagger.js';
import { DB_CONNECTION, type Database } from '../../db/index.js';
import { devices, type Device } from '../../db/schema.js';
import { hashDeviceToken, looksLikeDeviceToken } from './device-token.js';

export const DEVICE_TOKEN_HEADER = 'x-device-token';
const DEVICE_AUTH_KEY = 'deviceAuth';

export type DeviceRequest = Request & { device?: Device };

/**
 * `X-Device-Token`으로 기기를 확인하고 request.device에 넣는다.
 * 경로에 :deviceId가 있으면 토큰의 기기와 같아야 한다. 다른 기기의 편성을 받아 갈 수 없다.
 * 토큰을 URL query로 받지 않는다(공개 화면 URL이 로그·기록에 남는다).
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(@Inject(DB_CONNECTION) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const token = request.headers[DEVICE_TOKEN_HEADER];
    if (typeof token !== 'string' || !looksLikeDeviceToken(token)) {
      throw unauthenticated('Missing or malformed device token');
    }

    const [device] = await this.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.tokenHash, hashDeviceToken(token)),
          eq(devices.isActive, true),
        ),
      );
    if (!device) {
      throw unauthenticated('Invalid device token');
    }

    const pathDeviceId = request.params?.deviceId;
    if (pathDeviceId !== undefined && pathDeviceId !== device.id) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Device token does not match this device',
      );
    }

    request.device = device;
    return true;
  }
}

function unauthenticated(message: string): AppException {
  return new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHENTICATED,
    message,
  );
}

/**
 * TV가 부르는 라우트에 붙인다. 사용자 JWT 대신 기기 토큰으로 인증한다.
 * 전역 JwtAuthGuard는 건너뛰고(@Public) 이 라우트 전용 DeviceAuthGuard가 확인한다.
 */
export function DeviceAuth() {
  return applyDecorators(
    Public(),
    SetMetadata(DEVICE_AUTH_KEY, true),
    UseGuards(DeviceAuthGuard),
    ApiSecurity(DEVICE_TOKEN_AUTH),
    ApiHeader({
      name: 'X-Device-Token',
      required: true,
      description: '관리자가 기기를 등록·재발급할 때 받은 기기 토큰 (fgd_...)',
    }),
  );
}

/** DeviceAuthGuard가 확인한 기기 */
export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Device => {
    const device = ctx.switchToHttp().getRequest<DeviceRequest>().device;
    if (!device) {
      throw unauthenticated('Missing device');
    }
    return device;
  },
);
