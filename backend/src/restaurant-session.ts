import {
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { unauthorizedFailure } from './api-failures';
import { InMemoryStore } from './in-memory-store';

const RESTAURANT_SESSION_COOKIE = 'restaurant_session';
const restaurantPrincipal = Symbol('restaurantPrincipal');

export interface RestaurantPrincipal {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
}

export interface AuthenticatedRestaurantRequest extends Request {
  readonly [restaurantPrincipal]: RestaurantPrincipal;
}

type RestaurantSessionRequest = Request & {
  [restaurantPrincipal]?: RestaurantPrincipal;
};

export function getRestaurantPrincipal(
  request: Request,
): RestaurantPrincipal {
  const principal = (request as RestaurantSessionRequest)[restaurantPrincipal];
  if (principal === undefined) {
    throw new Error('Authenticated restaurant principal is unavailable.');
  }

  return principal;
}

export const CurrentRestaurant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RestaurantPrincipal =>
    getRestaurantPrincipal(context.switchToHttp().getRequest<Request>()),
);

@Injectable()
export class RestaurantSessionGuard implements CanActivate {
  constructor(private readonly store: InMemoryStore) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RestaurantSessionRequest>();
    Reflect.deleteProperty(request, restaurantPrincipal);

    const signedCookies = (request as unknown as { signedCookies?: unknown })
      .signedCookies;
    if (
      typeof signedCookies !== 'object' ||
      signedCookies === null ||
      !Object.prototype.hasOwnProperty.call(
        signedCookies,
        RESTAURANT_SESSION_COOKIE,
      )
    ) {
      throw unauthorizedFailure();
    }

    const slug = (signedCookies as Record<string, unknown>)[
      RESTAURANT_SESSION_COOKIE
    ];
    if (typeof slug !== 'string' || slug.length === 0) {
      throw unauthorizedFailure();
    }

    const restaurant = this.store.findRestaurantBySlug(slug);
    if (restaurant === undefined || !restaurant.verified) {
      throw unauthorizedFailure();
    }

    const principal = Object.freeze<RestaurantPrincipal>({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
    });
    Object.defineProperty(request, restaurantPrincipal, {
      configurable: true,
      enumerable: false,
      value: principal,
      writable: false,
    });

    return true;
  }
}

@Controller('api/restaurant-session')
@UseGuards(RestaurantSessionGuard)
export class RestaurantSessionController {
  @Get()
  session(
    @CurrentRestaurant() _principal: RestaurantPrincipal,
  ): { kind: 'allowed' } {
    return { kind: 'allowed' };
  }
}
