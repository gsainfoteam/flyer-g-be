import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator.js';

/**
 * ECS / 로드밸런서가 "이 컨테이너 살아있나?"를 확인하는 엔드포인트.
 * 200을 돌려주지 않으면 배포가 실패하고 컨테이너가 계속 재시작된다.
 */
@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: '헬스 체크' })
  check() {
    // DB를 붙인 뒤에는 여기에 DB 연결 체크를 추가한다.
    return this.health.check([]);
  }
}
