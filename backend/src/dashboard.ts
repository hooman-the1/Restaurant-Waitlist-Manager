import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';

import { notFoundFailure, unexpectedFailure } from './api-failures';
import { SystemClock } from './demo-data-seeder';
import { DashboardSnapshot, InMemoryStore } from './in-memory-store';
import {
  CurrentRestaurant,
  RestaurantPrincipal,
  RestaurantSessionGuard,
} from './restaurant-session';
import { StaffResolutionDto } from './request-dtos';

@Injectable()
export class DashboardNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return true;
  }
}

@Controller('api/dashboard')
@UseGuards(DashboardNoStoreGuard, RestaurantSessionGuard)
export class DashboardController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
  ) {}

  @Get()
  load(
    @CurrentRestaurant() principal: RestaurantPrincipal,
  ): { kind: 'success'; dashboard: DashboardSnapshot } {
    const dashboard = this.store.readDashboardSnapshot(
      principal.id,
      this.clock.now(),
    );
    if (dashboard === undefined) {
      throw unexpectedFailure();
    }

    return { kind: 'success', dashboard };
  }
}

@Controller('api/dashboard/waitlist-entries')
@UseGuards(RestaurantSessionGuard)
export class StaffWaitlistResolutionController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
  ) {}

  @Patch(':actionReference')
  resolve(
    @CurrentRestaurant() principal: RestaurantPrincipal,
    @Param('actionReference') actionReference: string,
    @Body() input: StaffResolutionDto,
  ): { kind: 'success' } {
    const result = this.store.resolveWaitlistEntryByActionReference(
      principal.id,
      actionReference,
      input.resolution,
      () => this.clock.now(),
    );
    if (result.kind === 'not-found') {
      throw notFoundFailure();
    }

    return { kind: 'success' };
  }
}
