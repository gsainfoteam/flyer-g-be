import { ApiProperty } from '@nestjs/swagger';

export class TargetGroupDto {
  @ApiProperty({
    description: '그룹 ID. 관리 화면에서 만든 그룹은 서버가 정한다',
    example: 'grp_house_a',
  })
  id: string;

  @ApiProperty({ description: '표시 이름', example: '학사기숙사 A동' })
  name: string;

  @ApiProperty({
    description: '그룹에 속한 활성 기기 수 (비활성 기기는 세지 않는다)',
    example: 2,
  })
  deviceCount: number;

  @ApiProperty({
    description:
      '숨긴 그룹. 기기·신청에 새로 고를 수 없지만, 이미 연결된 기기·신청과 편성은 그대로다. 선택 목록에서는 빼고, 과거 신청의 그룹 이름을 보여 줄 때는 쓴다',
    example: false,
  })
  isHidden: boolean;
}
