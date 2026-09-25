import { ApiProperty } from '@nestjs/swagger';

/** NestJS 기본 예외 응답 형태. 공통 오류 규격(code, requestId)이 정해지면 교체한다. */
export class ErrorResponseDto {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({
    description: '오류 메시지. 입력 검증 실패(400)면 메시지 배열',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Invalid access token',
  })
  message: string | string[];

  @ApiProperty({ example: 'Unauthorized' })
  error: string;
}
