import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  LoginRequestDto,
  RefreshRequestDto,
  SessionResponseDto,
  TokenResponseDto,
} from './dto/auth.dto.js';
import type { AuthUser } from './types/auth-user.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: '로그인',
    description: `IdP authorization code로 로그인하고 access token을 발급한다.

1. 프론트가 \`https://account.gistory.me/authorize\`로 보낸다
   (scope: \`openid profile email offline_access\`, PKCE 권장)
2. redirect로 받은 code를 이 API로 넘긴다
3. 서버가 IdP 토큰으로 교환하고 사용자를 확인한 뒤 자체 access token을 발급한다`,
  })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiBadRequestResponse({
    description: '입력 검증 실패',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'code 만료·재사용, redirectUri 또는 codeVerifier 불일치',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({ description: 'IdP 장애', type: ErrorResponseDto })
  login(@Body() dto: LoginRequestDto): Promise<TokenResponseDto> {
    return this.authService.login(dto.code, dto.redirectUri, dto.codeVerifier);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: '토큰 갱신',
    description:
      'IdP refresh token으로 access token을 다시 발급한다. 응답의 refreshToken으로 교체해 저장한다.',
  })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiBadRequestResponse({
    description: '입력 검증 실패',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'refresh token 만료·무효. 다시 로그인해야 한다',
    type: ErrorResponseDto,
  })
  @ApiBadGatewayResponse({ description: 'IdP 장애', type: ErrorResponseDto })
  refresh(@Body() dto: RefreshRequestDto): Promise<TokenResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('session')
  @ApiBearerAuth(BEARER_AUTH)
  @ApiOperation({
    summary: '세션 복원',
    description: '앱 시작 시 현재 로그인 사용자와 역할을 확인한다.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({
    description: '토큰 없음·만료·무효, 또는 삭제된 사용자',
    type: ErrorResponseDto,
  })
  getSession(@CurrentUser() user: AuthUser): SessionResponseDto {
    return this.authService.toSession(user);
  }

  /**
   * 서버에 저장한 세션이 없으므로 할 일이 없다. 클라이언트가 토큰을 지운다.
   * IdP discovery에 revocation_endpoint가 없어 refresh token 회수도 하지 않는다.
   * 만료된 토큰으로도 로그아웃할 수 있도록 공개해 둔다.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: '로그아웃',
    description:
      '서버 측 동작은 없다. 클라이언트가 저장한 accessToken과 refreshToken을 지운다.',
  })
  @ApiNoContentResponse()
  logout(): void {}
}
