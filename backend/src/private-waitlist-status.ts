import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';

import { notFoundFailure } from './api-failures';
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
  constructor(private readonly store: InMemoryStore) {}

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
}
