-- 기기가 heartbeat로 알리는 "지금 장면"(FE 요청 4). 옛 플레이어는 보내지 않으므로 null을 허용한다.
ALTER TABLE "devices" ADD COLUMN "now_playing" jsonb;