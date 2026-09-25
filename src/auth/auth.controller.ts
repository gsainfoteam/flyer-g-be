import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import {
  LoginRequestDto,
  RefreshRequestDto,
  type SessionResponseDto,
  type TokenResponseDto,
} from './dto/auth.dto.js';
import type { AuthUser } from './types/auth-user.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** IdP authorization code로 로그인하고 access token을 발급한다. */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginRequestDto): Promise<TokenResponseDto> {
    return this.authService.login(dto.code, dto.redirectUri, dto.codeVerifier);
  }

  /** IdP refresh token으로 access token을 다시 발급한다. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshRequestDto): Promise<TokenResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  /** 앱 시작 시 세션 복원용. 토큰이 없거나 만료됐으면 401. */
  @Get('session')
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
  logout(): void {}
}
