import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';
import {
  assignRequestId,
  type RequestWithId,
} from '../request-id/request-id.js';
import { AppException } from './app.exception.js';
import { defaultCodeForStatus } from './error-code.js';

/**
 * 모든 예외를 `{ code, message, requestId, fields? }` 형태로 내려준다.
 * 5xx는 내부 정보를 숨기고 스택을 로그로 남긴다. 로그의 requestId로 문의를 추적한다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();

    // body-parser 오류처럼 Nest 미들웨어보다 먼저 난 예외는 아직 requestId가 없다.
    const requestId = assignRequestId(req, res);
    const { status, body } = toErrorResponse(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (res.headersSent) {
      return;
    }
    res.status(status).json(body);
  }
}

export function toErrorResponse(
  exception: unknown,
  requestId: string,
): { status: number; body: ErrorResponseDto } {
  if (exception instanceof AppException) {
    const status = exception.getStatus();
    return {
      status,
      body: {
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.fields && { fields: exception.fields }),
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      body: {
        code: defaultCodeForStatus(status),
        message: messageOf(exception),
        requestId,
      },
    };
  }

  // body-parser(http-errors)가 던지는 잘못된 JSON(400)·용량 초과(413) 등
  const clientStatus = clientErrorStatusOf(exception);
  if (clientStatus) {
    return {
      status: clientStatus,
      body: {
        code: defaultCodeForStatus(clientStatus),
        message: exception instanceof Error ? exception.message : 'Bad request',
        requestId,
      },
    };
  }

  return {
    status: 500,
    body: {
      code: defaultCodeForStatus(500),
      message: 'Internal server error',
      requestId,
    },
  };
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const { message } = response as { message?: unknown };
  if (Array.isArray(message)) {
    return message.join(', ');
  }
  return typeof message === 'string' ? message : exception.message;
}

/** http-errors 규약: 클라이언트에 노출해도 되는 4xx 오류는 status와 expose를 가진다. */
function clientErrorStatusOf(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const { status, expose } = exception as {
    status?: unknown;
    expose?: unknown;
  };
  return typeof status === 'number' && status >= 400 && status < 500 && expose
    ? status
    : undefined;
}
