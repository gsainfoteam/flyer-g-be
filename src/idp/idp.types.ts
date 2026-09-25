import { z } from 'zod';

/** IdP /oauth/token 응답 (authorization_code, refresh_token grant 공통) */
export const idpTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number(),
  // offline_access scope로 요청했을 때만 내려온다.
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

export type IdpTokenResponse = z.infer<typeof idpTokenResponseSchema>;

/**
 * IdP /oauth/userinfo 응답. 프론트가 authorize 요청에
 * `profile email` scope를 넣어야 name, email이 내려온다.
 */
export const idpUserInfoSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(1),
  picture: z.string().optional(),
  profile: z.string().optional(),
  student_id: z.string().optional(),
});

/** 서비스 코드에서 쓰는 camelCase 사용자 정보 */
export type IdpUserInfo = {
  uuid: string;
  name: string;
  email: string;
  studentId?: string;
};
