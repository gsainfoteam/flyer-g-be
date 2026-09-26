import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { BEARER_AUTH } from '../config/swagger.js';
import { CategoriesService } from './categories.service.js';
import { CategoryDto } from './dto/category.dto.js';

@ApiTags('Reference')
@ApiBearerAuth(BEARER_AUTH)
@Controller('signage/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: '카테고리 목록',
    description:
      '신청 폼의 카테고리 선택지. 노출 순서대로 준다. 숨긴 카테고리는 빠지지만 기존 신청의 categoryId로는 계속 쓰인다.',
  })
  @ApiOkResponse({ type: [CategoryDto] })
  @ApiUnauthorizedResponse({
    description: '로그인 필요',
    type: ErrorResponseDto,
  })
  findAll(): Promise<CategoryDto[]> {
    return this.categoriesService.findActive();
  }
}
