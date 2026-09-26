import { ApiProperty } from '@nestjs/swagger';

export class CategoryDto {
  @ApiProperty({ description: '카테고리 ID', example: 'performance' })
  id: string;

  @ApiProperty({ description: '표시 이름', example: '공연' })
  name: string;
}
