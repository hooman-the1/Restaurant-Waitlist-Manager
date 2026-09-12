import { Controller, Get, Param } from '@nestjs/common';

import { notFoundFailure } from './api-failures';
import { InMemoryStore } from './in-memory-store';

@Controller('api/restaurants')
export class PublicRestaurantLookupController {
  constructor(private readonly store: InMemoryStore) {}

  @Get(':restaurantSlug')
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
