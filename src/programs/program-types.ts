/**
 * 운영 컨텐츠 종류 레지스트리. 종류 하나 = 정의 파일 하나다(⑩에서 종류를 등록한다).
 * 정보줄에 쓸 수 있는 종류는 infoBarItem으로 그 칸 이름을 정한다.
 */
export type ProgramTypeDefinition = {
  type: string;
  infoBarItem?: string;
};

export const PROGRAM_TYPES: readonly ProgramTypeDefinition[] = [];

/** 이 종류가 들어갈 수 있는 정보줄 칸. 정보줄에 쓸 수 없는 종류면 undefined */
export function infoBarItemOf(type: string): string | undefined {
  return PROGRAM_TYPES.find((definition) => definition.type === type)
    ?.infoBarItem;
}
