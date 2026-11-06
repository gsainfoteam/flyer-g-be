<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

영상 포스터 처리와 그 테스트에는 `ffmpeg`·`ffprobe`가 필요하다 (macOS: `brew install ffmpeg`). 배포 이미지와 CI에는 설치되어 있다.

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

### Slack notifications

`SLACK_WEBHOOK_URL`에 Slack Incoming Webhook URL을 설정한다. 모든 알림은 같은 웹훅 채널로 보낸다. 웹훅이 비어 있으면 알림 생성·발송을 모두 건너뛴다. 실제 웹훅은 저장소에 넣지 않고 배포 환경의 Secret으로 관리한다.

버튼 주소는 코드에 고정되어 있다. **기기 상태 확인하기**는 `https://flyer-g.gistory.me/tv`, **승인 요청 확인하기**는 `https://flyer-g.gistory.me/review`로 이동한다. 개발 환경에서도 같은 운영 화면을 연다. 기존 대기 알림도 발송 시 종류에 맞는 주소를 사용한다.

| 환경변수 | 기본값 | 용도 |
| --- | --- | --- |
| `SLACK_WEBHOOK_URL` | 없음 | Slack Incoming Webhook HTTPS URL |
| `SLACK_DEVICE_ALERTS_ENABLED` | `true` | TV 연결 끊김·복구 알림 |
| `SLACK_REVIEW_REMINDERS_ENABLED` | `true` | 승인 대기 리마인드 |
| `SCHEDULER_ENABLED` | `true` | 위 알림을 포함한 모든 주기 작업 실행 여부 |

- **TV 장애:** 매분 확인하며 마지막 heartbeat가 90초 넘게 끊기면 알린다. 실제 전원 고장과 네트워크 단절은 구분하지 않는다. 미접속·비활성·화면 끔 시간의 기기는 제외하며, 화면 끔 시간 종료와 재활성화/기기 설정 변경 직후에는 최소 90초를 유예한다. 같은 장애는 한 번만 생성하고 꺼져 있는 동안 반복 알림을 보내지 않는다.
- **TV 복구:** 알려진 장애에서 새 heartbeat가 수신되고 최근 90초 안의 응답임을 다음 매분 점검에서 확인하면 복구 알림을 한 번 생성한다. 해당 장애 알림이 Slack에 성공적으로 전송된 경우에만 복구를 전송한다. 첫 접속·비활성화·단순 휴면 전환은 복구로 알리지 않으며, 화면 끔 시간이라도 실제 새 heartbeat로 복구가 확인되면 알린다. 표시하는 경과 시간은 최초 장애 감지부터 복구 확인까지다. 새 장애가 생기거나 다시 응답이 끊겼다면 대기 중인 옛 복구 알림은 취소한다.
- **승인:** 월~금 10:00·16:00 **Asia/Seoul**에 현재 `PENDING_REVIEW` 전체·종류별 건수와 가장 오래된 대기 시간을 보낸다. 0건이면 생략하며 건수가 같아도 다음 시각에는 다시 알린다. 공휴일은 별도로 제외하지 않는다. 모든 서버가 예정 시각에 중단되어 있으면 그 회차는 소급 생성하지 않는다.
- 알림은 DB에 저장한 뒤 5초 주기로 한 건씩 발송한다. 여러 파드는 DB 잠금·고유 키·발송 리스를 공유한다. 전송 직전에 복구·휴면·비활성화된 TV의 대기 장애 알림은 취소한다. 장애 전송 중 재접속해도 복구 기록을 유지하고, 장애 발송 결과가 확정된 후 복구 전송 여부를 판단한다. 그동안 다른 알림은 계속 처리한다.
- Slack 화면은 색상 바(TV 장애: 빨강, TV 복구·승인 대기: 초록), 강조된 요약, 항목별 정보, 시각 보조 문구, 관리자 화면 버튼으로 구성한다. 복구 메시지는 `✅ TV 연결 복구`로 표시하고 기기 상태 확인 버튼은 `/tv`로 연결한다. Block Kit 표시 정보도 DB에 함께 저장해 재시도 시 유지하며, 푸시 알림·스크린리더에는 전체 텍스트를 제공한다.
- 네트워크/5xx 오류는 1·2·4·8분 간격으로 최대 5회 시도한다. 429는 Slack의 `Retry-After` 동안 웹훅 전체 발송을 쉰다. 다른 4xx는 즉시 실패 처리하며, 생성 후 1시간 지난 미전송 알림은 취소한다. 판정/집계 시각은 메시지에 표시한다.
- `slack_notifications`의 `status`, `attempts`, `last_error`, `sent_at`으로 결과를 확인한다. 웹훅 URL과 응답 본문은 발송 오류 로그에 기록하지 않는다. Slack이 수신한 직후 프로세스가 종료되거나 응답이 유실되면 재시도 메시지가 중복될 수 있다.

앱 시작 시 `0024_slack_notifications` 마이그레이션이 자동 적용된다. 표시 정보가 없는 기존 대기 알림은 텍스트 형식으로 계속 발송한다. 배포 환경변수/Secret은 별도 GitOps 저장소에서 설정한다. 통합 테스트는 테스트 전용 PostgreSQL에서 실행하고, Slack 발송은 대체 객체로 검증한다.

Webhook 설정과 응답 규약은 [Slack 공식 문서](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/), 속도 제한은 [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)를 참고한다.

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
