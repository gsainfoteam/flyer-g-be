import { Trace } from '@gsainfoteam/nest-observability';
import { Injectable } from '@nestjs/common';

@Trace()
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
