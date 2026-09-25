import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';

/** Swagger 문서용. items를 뺀 목록 봉투 필드 */
export class PageEnvelopeDto {
  @ApiProperty({
    description: '다음 페이지 cursor. 마지막 페이지면 null',
    type: String,
    nullable: true,
    example: 'WyIyMDI2LTA3LTI5VDA2OjMwOjAwLjAwMFoiLCJzdWJfMDEiXQ',
  })
  nextCursor: string | null;

  @ApiProperty({ description: '필터에 맞는 전체 항목 수', example: 137 })
  totalCount: number;

  @ApiProperty({
    description:
      '서버 현재 시각(UTC). 상태·기간 판정은 클라이언트 시계 대신 이 값으로 한다',
    example: '2026-07-29T06:30:00.000Z',
  })
  serverTime: string;
}

/** 200 응답이 `{ items: model[], nextCursor, totalCount, serverTime }`임을 문서화한다. */
export function ApiPageResponse(model: Type<unknown>, description?: string) {
  return applyDecorators(
    ApiExtraModels(PageEnvelopeDto, model),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageEnvelopeDto) },
          {
            type: 'object',
            required: ['items'],
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
}
