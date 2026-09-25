import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
  validate,
} from 'class-validator';
import { AppException } from './app.exception.js';
import {
  flattenValidationErrors,
  validationExceptionFactory,
} from './validation.js';

class ResolutionDto {
  @IsInt()
  @Min(1, { message: '가로 해상도는 1 이상이어야 합니다.' })
  width: number;
}

class SampleDto {
  @IsString()
  @IsNotEmpty({ message: '제목을 입력하세요.' })
  title: string;

  @ValidateNested()
  @Type(() => ResolutionDto)
  resolution: ResolutionDto;

  @IsString({ each: true, message: '그룹 ID는 문자열이어야 합니다.' })
  targetGroupIds: string[];
}

async function errorsFor(plain: object) {
  return validate(plainToInstance(SampleDto, plain));
}

describe('flattenValidationErrors', () => {
  it('필드별 첫 번째 문구를 점 경로로 편다', async () => {
    const errors = await errorsFor({
      title: '',
      resolution: { width: 0 },
      targetGroupIds: ['grp_a'],
    });

    expect(flattenValidationErrors(errors)).toEqual({
      title: '제목을 입력하세요.',
      'resolution.width': '가로 해상도는 1 이상이어야 합니다.',
    });
  });

  it('오류가 없으면 빈 객체', async () => {
    const errors = await errorsFor({
      title: '공연',
      resolution: { width: 1920 },
      targetGroupIds: [],
    });
    expect(flattenValidationErrors(errors)).toEqual({});
  });
});

describe('validationExceptionFactory', () => {
  it('422 VALIDATION_FAILED와 fields를 만든다', async () => {
    const errors = await errorsFor({
      title: '',
      resolution: { width: 1 },
      targetGroupIds: [],
    });
    const exception = validationExceptionFactory(errors);

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.getStatus()).toBe(422);
    expect(exception.code).toBe('VALIDATION_FAILED');
    expect(exception.fields).toEqual({ title: '제목을 입력하세요.' });
  });
});
