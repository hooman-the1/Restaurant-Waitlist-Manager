import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  HttpCode,
  HttpStatus,
  Injectable,
  NestInterceptor,
  Optional,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { sign } from 'cookie-signature';
import { Response } from 'express';
import { Observable, catchError, throwError } from 'rxjs';

import { invalidOrUsedTokenFailure } from './api-failures';
import { ApiContractOperation } from './api-documentation';
import { InMemoryStore } from './in-memory-store';
import { RestaurantVerificationDto } from './request-dtos';

const RESTAURANT_SESSION_COOKIE = 'restaurant_session';

@Injectable()
export class RestaurantSessionSigner {
  constructor(@Optional() private readonly config?: ConfigService) {}

  sign(slug: string): string {
    const secret = this.config?.get<string>('SECRET_KEY');
    if (secret === undefined || secret.length === 0) {
      throw new Error('Signing configuration is unavailable.');
    }

    return `s:${sign(slug, secret)}`;
  }
}

@Injectable()
export class VerificationDtoFailureInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof BadRequestException) {
          return throwError(() => invalidOrUsedTokenFailure());
        }

        return throwError(() => error);
      }),
    );
  }
}

@Controller('api/restaurant-verifications')
@UseInterceptors(VerificationDtoFailureInterceptor)
@ApiTags('Restaurant accounts')
export class RestaurantVerificationController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly signer: RestaurantSessionSigner,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiContractOperation('/api/restaurant-verifications', 'post')
  verify(
    @Body() input: RestaurantVerificationDto,
    @Res({ passthrough: true }) response: Response,
  ): { kind: 'success' } {
    const verification = this.store.findVerificationToken(input.token);
    if (verification === undefined) {
      throw invalidOrUsedTokenFailure();
    }

    const restaurant = this.store.findRestaurantById(verification.restaurantId);
    if (restaurant === undefined || restaurant.verified) {
      this.store.verifyRestaurantWithToken(input.token);
      throw invalidOrUsedTokenFailure();
    }

    const signedSession = this.signer.sign(restaurant.slug);
    const result = this.store.verifyRestaurantWithToken(input.token);
    if (result.kind === 'invalid') {
      throw invalidOrUsedTokenFailure();
    }

    response.cookie(RESTAURANT_SESSION_COOKIE, signedSession, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
    });

    return { kind: 'success' };
  }
}
