import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';

import { notFoundFailure } from './api-failures';
import { SystemClock } from './demo-data-seeder';
import {
  InMemoryStore,
  PrivateWaitlistStatusReadResult,
} from './in-memory-store';

type PrivateWaitlistStatusView = Exclude<
  PrivateWaitlistStatusReadResult,
  { kind: 'not-found' }
>;

@Controller('api/waitlist-entries')
export class PrivateWaitlistStatusController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
  ) {}

  @Get(':privateToken')
  lookup(
    @Param('privateToken') privateToken: string,
    @Res({ passthrough: true }) response: Response,
  ): PrivateWaitlistStatusView {
    response.setHeader('Cache-Control', 'no-store');
    const result = this.store.readPrivateWaitlistStatus(privateToken);
    if (result.kind === 'not-found') {
      throw notFoundFailure();
    }

    return result;
  }

  @Post(':privateToken/cancellations')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('privateToken') privateToken: string,
  ): { kind: 'cancelled' } {
    const result = this.store.cancelWaitlistEntry(privateToken, () =>
      this.clock.now(),
    );
    if (result.kind === 'not-found') {
      throw notFoundFailure();
    }

    return { kind: 'cancelled' };
  }
}
