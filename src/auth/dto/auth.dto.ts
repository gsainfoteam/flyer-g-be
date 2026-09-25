import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import type { Role } from '../types/role.js';

const ROLES: Role[] = ['SUBMITTER', 'REVIEWER', 'SUPER_ADMIN'];

export class LoginRequestDto {
  @ApiProperty({
    description: 'IdP authorize 후 redirect로 받은 authorization code',
    example: 'NhhvTDYsFcdgNLnnLijcl7Ku7bEEeee',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: 'authorize 요청에 썼던 redirect_uri와 정확히 같아야 한다',
    example: 'http://localhost:5173/auth/callback',
  })
  @IsUrl({ require_tld: false, require_protocol: true })
  redirectUri: string;

  @ApiPropertyOptional({
    description: 'PKCE를 썼다면 code_challenge를 만든 원본 값',
    example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  codeVerifier?: string;
}

export class RefreshRequestDto {
  @ApiProperty({
    description: '로그인 응답으로 받은 IdP refresh token',
    example: 'D43f5y0ahjqew82jZ4NViEr2YafMKhue',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class TokenResponseDto {
  @ApiProperty({
    description:
      '우리 서버가 발급한 access token. `Authorization: Bearer <accessToken>`으로 보낸다',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiPropertyOptional({
    description:
      'IdP refresh token. authorize 때 offline_access scope를 요청해야 내려온다',
    example: 'D43f5y0ahjqew82jZ4NViEr2YafMKhue',
  })
  refreshToken?: string;

  @ApiProperty({ description: 'accessToken 유효 시간(초)', example: 3600 })
  expiresIn: number;
}

export class SessionUserDto {
  @ApiProperty({
    description: '사용자 ID',
    example: '79ad1364-82b4-4134-b2a3-d9cbe17cc444',
  })
  id: string;

  @ApiProperty({ example: '홍길동' })
  displayName: string;

  @ApiProperty({ example: 'user@gm.gist.ac.kr' })
  email: string;

  @ApiProperty({
    description: 'SUBMITTER는 로그인한 모든 사용자가 가진다',
    enum: ROLES,
    isArray: true,
    example: ['SUBMITTER', 'REVIEWER'],
  })
  roles: Role[];

  @ApiProperty({
    description: '소속 조직 ID 목록. 조직 모델 설계 전까지 항상 빈 배열',
    type: [String],
    example: [],
  })
  organizationIds: string[];
}

export class SessionResponseDto {
  @ApiProperty({ type: SessionUserDto })
  user: SessionUserDto;

  @ApiProperty({
    description: '현재 access token 만료 시각 (UTC ISO 8601)',
    example: '2026-07-29T12:00:00.000Z',
  })
  expiresAt: string;
}
