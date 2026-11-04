import { RELAY_CLOSE, RELAY_LIMITS } from './game-relay.js';

/**
 * WebSocket 프로토콜 설명. OpenAPI에는 WebSocket을 적을 자리가 없어 Swagger 문서 머리말에 싣는다.
 * 프레임은 모두 JSON 텍스트다.
 */
export const SOCKET_PROTOCOL_DOC = `
## WebSocket

### TV: \`wss://<api>/devices/ws\`

TV 하나의 연결. 제어 채널이면서 그 기기 방의 게임 호스트다. 쿼리는 없다.

| 방향 | type | 내용 |
|---|---|---|
| TV → 서버 | \`auth\` | \`{ type, token }\` 기기 토큰. 연결 뒤 첫 메시지로 ${RELAY_LIMITS.authTimeoutMs / 1000}초 안에 보낸다 |
| TV → 서버 | \`send\` | \`{ type, data }\` 방의 모든 참가자에게 간다 |
| 서버 → TV | \`ready\` | 인증 성공 |
| 서버 → TV | \`program-changed\` | 편성이 바뀌었다. 편성을 다시 받는다(ETag를 보내면 바뀐 것이 없을 때 304). 변경을 1초쯤 모아 보낸다 |
| 서버 → TV | \`reload\` | 운영자가 새로고침을 눌렀다(POST /signage/devices/{id}/reload). 페이지를 다시 불러온다 |
| 서버 → TV | \`join\` | \`{ type, from }\` 참가자가 붙었다. from은 서버가 정한 연결 id |
| 서버 → TV | \`message\` | \`{ type, from, data }\` 참가자가 보낸 것 |
| 서버 → TV | \`left\` | \`{ type, from }\` 참가자가 나갔다 |

program-changed를 보내는 경우: 신청 승인·중단·취소와 상태 배치(모든 TV), 그룹 편성·그룹 라이브(그 그룹을 편성 그룹이나 위치 그룹으로 가진 TV), 기기 수정·기기 라이브(그 TV).
연결이 끊겨 있던 동안의 알림은 다시 보내지 않는다. 다시 붙으면 편성을 한 번 받는다.

연결 확인은 WebSocket 프로토콜 ping이다(${RELAY_LIMITS.heartbeatMs / 1000}초마다). 브라우저가 스스로 답하므로 앱이 할 일은 없다. 다음 ping까지 답이 없으면 끊는다.

### 참가자(폰): \`wss://<api>/games/ws?room=<기기 id>&role=player\`

로그인 없이 붙는다. 방이 실제 활성 기기가 아니면 404로 받지 않는다.

| 방향 | type | 내용 |
|---|---|---|
| 폰 → 서버 | \`send\` | \`{ type, data }\` 그 방의 TV에게 간다 |
| 서버 → 폰 | \`host\` | \`{ type, online }\` TV가 붙어 있는지. 붙을 때와 TV가 오갈 때 |
| 서버 → 폰 | \`message\` | \`{ type, data }\` TV가 보낸 것 |

\`/games/ws?room=<기기 id>&role=host\`는 이전 TV 경로다. \`/devices/ws\`와 같고 정리 배포에서 지운다.

### 상한과 종료 코드

- 메시지 하나 ${RELAY_LIMITS.maxMessageBytes}바이트, 연결 하나 초당 ${RELAY_LIMITS.messagesPerSecond}개. 넘는 메시지는 버린다
- 방 하나의 참가자 ${RELAY_LIMITS.maxPlayersPerRoom}명
- 연결 전에 HTTP로 거절하는 경우: 잘못된 쿼리 400, 허용하지 않은 Origin 403(CORS 허용 목록과 같은 기준), 없는 방 404, IP 하나의 연결이 너무 많음 429, 서버 연결 수 초과 503

| 코드 | 뜻 |
|---|---|
| ${RELAY_CLOSE.unauthorized} | 인증 실패·시간 초과, 토큰 재발급, 기기 끔 |
| ${RELAY_CLOSE.forbidden} | (이전 경로) 토큰이 room의 기기 것이 아님 |
| ${RELAY_CLOSE.roomFull} | 방이 참 |
| ${RELAY_CLOSE.replaced} | 같은 기기가 새로 연결함 |
`;
