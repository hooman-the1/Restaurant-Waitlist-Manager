import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiContractOperation } from './api-documentation';
import { notFoundFailure } from './api-failures';
import { InMemoryStore } from './in-memory-store';

@Controller('api/restaurants')
@ApiTags('Public waitlist')
export class PublicRestaurantLookupController {
  constructor(private readonly store: InMemoryStore) {}

  @Get(':restaurantSlug')
  @ApiContractOperation('/api/restaurants/{restaurantSlug}', 'get')
  lookup(@Param('restaurantSlug') restaurantSlug: string): {
    kind: 'success';
    restaurant: { restaurantName: string };
  } {
    const restaurant = this.store.findRestaurantBySlug(restaurantSlug);
    if (restaurant === undefined) {
      throw notFoundFailure();
    }

    return {
      kind: 'success',
      restaurant: { restaurantName: restaurant.name },
    };
  }
}
