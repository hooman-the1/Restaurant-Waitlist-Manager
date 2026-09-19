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
import { ApiTags } from '@nestjs/swagger';

import { ApiContractOperation } from './api-documentation';
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
@ApiTags('Private status')
export class PrivateWaitlistStatusController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
  ) {}

  @Get(':privateToken')
  @ApiContractOperation('/api/waitlist-entries/{privateToken}', 'get')
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
  @ApiContractOperation(
    '/api/waitlist-entries/{privateToken}/cancellations',
    'post',
  )
  async cancel(
    @Param('privateToken') privateToken: string,
  ): Promise<{ kind: 'cancelled' }> {
    const result = await this.store.cancelWaitlistEntryPersistent(
      privateToken,
      () => this.clock.now(),
    );
    if (result.kind === 'not-found') {
      throw notFoundFailure();
    }

    return { kind: 'cancelled' };
  }
}
