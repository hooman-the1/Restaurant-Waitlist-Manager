import { Body, Controller, Injectable, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiContractOperation } from './api-documentation';
import {
  duplicatePhoneFailure,
  notFoundFailure,
  unexpectedFailure,
  validationFailure,
} from './api-failures';
import { SystemClock } from './demo-data-seeder';
import {
  generateActionReference,
  generatePrivateStatusToken,
  normalizePhoneForComparison,
} from './domain-utilities';
import { InMemoryStore } from './in-memory-store';
import { JoinWaitlistDto } from './request-dtos';

const MAX_CAPABILITY_ATTEMPTS = 3;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PrivateStatusTokenSource {
  generate(): string {
    return generatePrivateStatusToken();
  }
}

@Injectable()
export class ActionReferenceSource {
  generate(): string {
    return generateActionReference();
  }
}

@Controller('api/restaurants/:restaurantSlug/waitlist-entries')
@ApiTags('Public waitlist')
export class PublicWaitlistJoinController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly privateTokenSource: PrivateStatusTokenSource,
    private readonly actionReferenceSource: ActionReferenceSource,
    private readonly clock: SystemClock,
  ) {}

  @Post()
  @ApiContractOperation(
    '/api/restaurants/{restaurantSlug}/waitlist-entries',
    'post',
  )
  async join(
    @Param('restaurantSlug') restaurantSlug: string,
    @Body() input: JoinWaitlistDto,
  ): Promise<{ kind: 'success'; privateStatusToken: string }> {
    const restaurant = this.store.findRestaurantBySlug(restaurantSlug);
    if (restaurant === undefined) {
      throw notFoundFailure();
    }
    if (input.customerName.trim().length === 0) {
      throw validationFailure('Customer name is required.');
    }

    const normalizedPhone = normalizePhoneForComparison(input.phone);
    if (!/^\+?[0-9]+$/.test(normalizedPhone)) {
      throw validationFailure('Enter a valid phone number.');
    }
    if (this.store.hasActivePhoneDuplicate(restaurant.id, normalizedPhone)) {
      throw duplicatePhoneFailure();
    }

    for (let attempt = 0; attempt < MAX_CAPABILITY_ATTEMPTS; attempt += 1) {
      const privateStatusToken = this.privateTokenSource.generate();
      const actionReference = this.actionReferenceSource.generate();
      if (
        !UUID_V4.test(privateStatusToken) ||
        !UUID_V4.test(actionReference) ||
        privateStatusToken === actionReference ||
        this.store.hasWaitlistCapabilityCollision(
          privateStatusToken,
          actionReference,
        )
      ) {
        continue;
      }

      const result = await this.store.commitWaitlistJoinPersistent(
        restaurantSlug,
        {
          customerName: input.customerName,
          phone: input.phone,
          normalizedPhone,
          partySize: input.partySize,
          privateStatusToken,
          actionReference,
          joinedAt: this.clock.now(),
        },
      );
      if (result.kind === 'created') {
        return { kind: 'success', privateStatusToken };
      }
      if (result.kind === 'not-found') {
        throw notFoundFailure();
      }
      if (result.kind === 'duplicate-phone') {
        throw duplicatePhoneFailure();
      }
    }

    throw unexpectedFailure();
  }
}
