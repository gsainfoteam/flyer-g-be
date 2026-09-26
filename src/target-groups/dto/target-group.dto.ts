import { ApiProperty } from '@nestjs/swagger';

export class TargetGroupDto {
  @ApiProperty({ description: '그룹 ID', example: 'grp_house_a' })
  id: string;

  @ApiProperty({ description: '표시 이름', example: '학사기숙사 A동' })
  name: string;

  @ApiProperty({
    description: '그룹에 속한 활성 기기 수 (비활성 기기는 세지 않는다)',
    example: 2,
  })
  deviceCount: number;
}
