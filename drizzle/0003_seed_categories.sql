-- 카테고리 초기값. 이후 변경은 DB에서 직접 한다(이 파일을 고치지 않는다).
--
-- id는 프론트가 mock에 쓰던 임시 id와 같다. Ziggle 분류 체계가 정해지면
-- 새 id를 추가하고 기존 것은 is_active = false로 숨긴다.
INSERT INTO "categories" ("id", "name", "sort_order") VALUES
	('notice', '공지', 10),
	('club', '동아리', 20),
	('performance', '공연', 30),
	('event', '행사', 40),
	('department', '학과·부서', 50)
ON CONFLICT ("id") DO NOTHING;
