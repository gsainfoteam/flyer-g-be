import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CursorField,
  LimitField,
} from '../../common/pagination/cursor-query.dto.js';
import { grantedRoleEnum, type GrantedRole } from '../../db/schema.js';

export const USER_QUERY_MAX_LENGTH = 100;

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: `이름·이메일·학번에 포함된 문자열 (대소문자 무시, 최대 ${USER_QUERY_MAX_LENGTH}자). %와 _도 글자 그대로 찾는다`,
    example: '김지스트',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsString({ message: '검색어가 올바르지 않습니다.' })
  @MaxLength(USER_QUERY_MAX_LENGTH, {
    message: `검색어는 ${USER_QUERY_MAX_LENGTH}자 이하여야 합니다.`,
  })
  q?: string;

  @ApiPropertyOptional({
    description:
      '이 역할을 부여받은 사용자만. 부여된 역할 그대로 거른다(REVIEWER로 거르면 REVIEWER 없이 SUPER_ADMIN만 가진 사용자는 빠진다)',
    enum: grantedRoleEnum.enumValues,
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(grantedRoleEnum.enumValues, { message: '알 수 없는 역할입니다.' })
  role?: GrantedRole;

  @CursorField()
  cursor?: string;

  @LimitField(20)
  limit: number = 20;
}

/** 역할 관리 화면의 사용자 한 명 */
export class AdminUserDto {
  @ApiProperty({ example: '6f1c2c1e-0000-4000-8000-000000000002' })
  id: string;

  @ApiProperty({ description: 'IdP 이름', example: '김지스트' })
  name: string;

  @ApiProperty({ description: 'IdP 이메일', example: 'gist@gm.gist.ac.kr' })
  email: string;

  @ApiProperty({
    description: '학번. IdP가 주지 않았으면 null',
    type: String,
    nullable: true,
    example: '20245001',
  })
  studentId: string | null;

  @ApiProperty({
    description:
      '따로 부여된 역할. 로그인한 모두가 가지는 SUBMITTER는 넣지 않는다. SUPER_ADMIN은 REVIEWER 권한도 가진 것으로 본다',
    enum: grantedRoleEnum.enumValues,
    isArray: true,
    example: ['REVIEWER'],
  })
  grantedRoles: GrantedRole[];

  @ApiProperty({ example: '2026-09-30T08:00:00.000Z' })
  lastLoginAt: string;

  @ApiProperty({
    description: '첫 로그인 시각',
    example: '2026-03-02T01:00:00.000Z',
  })
  createdAt: string;
}
