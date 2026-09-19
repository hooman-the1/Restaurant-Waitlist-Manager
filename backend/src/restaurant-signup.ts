import { Body, Controller, Injectable, Optional, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { argon2id, hash as argon2Hash } from 'argon2';

import {
  signupConflictFailure,
  unexpectedFailure,
  validationFailure,
} from './api-failures';
import { ApiContractOperation } from './api-documentation';
import { SystemClock } from './demo-data-seeder';
import {
  generateRestaurantSlug,
  generateRestaurantVerificationToken,
  normalizeEmailForComparison,
  normalizeRestaurantDisplayName,
  normalizeRestaurantNameForComparison,
} from './domain-utilities';
import { InMemoryStore } from './in-memory-store';
import { RestaurantSignupDto } from './request-dtos';

const RESTAURANT_CONFLICT_MESSAGE =
  'A restaurant with that name or email already exists.';
const MAX_TOKEN_ATTEMPTS = 3;

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    return argon2Hash(password, { type: argon2id });
  }
}

@Injectable()
export class VerificationTokenSource {
  generate(): string {
    return generateRestaurantVerificationToken();
  }
}

@Injectable()
export class FrontendOrigin {
  constructor(@Optional() private readonly config?: ConfigService) {}

  get(): string {
    return (
      this.config?.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:4200'
    );
  }
}

@Injectable()
export class VerificationUrlLogger {
  log(line: string): void {
    console.log(line);
  }
}

@Controller('api/restaurants')
@ApiTags('Restaurant accounts')
export class RestaurantSignupController {
  constructor(
    private readonly store: InMemoryStore,
    private readonly hasher: PasswordHasher,
    private readonly tokenSource: VerificationTokenSource,
    private readonly clock: SystemClock,
    private readonly frontendOrigin: FrontendOrigin,
    private readonly logger: VerificationUrlLogger,
  ) {}

  @Post()
  @ApiContractOperation('/api/restaurants', 'post')
  async signup(
    @Body() input: RestaurantSignupDto,
  ): Promise<{ kind: 'success' }> {
    const name = normalizeRestaurantDisplayName(input.restaurantName);
    if (name.length === 0) {
      throw validationFailure('Restaurant name is required.');
    }

    const slug = generateRestaurantSlug(name);
    if (slug.length === 0) {
      throw validationFailure(
        'Restaurant name must contain a letter or number.',
      );
    }

    const email = input.email.trim();
    if (!isBasicEmail(email)) {
      throw validationFailure('Enter a valid email address.');
    }

    if ([...input.password].length < 8) {
      throw validationFailure('Password must be at least 8 characters.');
    }

    const normalizedName = normalizeRestaurantNameForComparison(name);
    const normalizedEmail = normalizeEmailForComparison(email);
    const uniquenessKeys = { normalizedName, normalizedEmail, slug };
    if (this.store.hasRestaurantConflict(uniquenessKeys)) {
      throw signupConflictFailure(RESTAURANT_CONFLICT_MESSAGE);
    }

    const passwordHash = await this.hasher.hash(input.password);
    const verificationToken = this.generateUnusedVerificationToken();
    if (verificationToken === undefined) {
      throw unexpectedFailure();
    }
    const createdAt = this.clock.now();
    const result = await this.store.commitRestaurantSignupPersistent(
      {
        name,
        normalizedName,
        email,
        normalizedEmail,
        passwordHash,
        slug,
        verified: false,
        createdAt,
      },
      verificationToken,
    );

    if (result.kind === 'conflict') {
      throw signupConflictFailure(RESTAURANT_CONFLICT_MESSAGE);
    }
    if (result.kind === 'token-collision') {
      throw unexpectedFailure();
    }

    const origin = this.frontendOrigin.get().replace(/\/$/, '');
    const line = `Restaurant verification URL: ${origin}/verify/${encodeURIComponent(verificationToken)}`;
    try {
      this.logger.log(line);
    } catch (error: unknown) {
      await this.store.rollbackRestaurantSignupPersistent(
        result.restaurant.id,
        verificationToken,
      );
      throw error;
    }

    return { kind: 'success' };
  }

  private generateUnusedVerificationToken(): string | undefined {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      const candidate = this.tokenSource.generate();
      if (this.store.findVerificationToken(candidate) === undefined) {
        return candidate;
      }
    }

    return undefined;
  }
}

function isBasicEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email);
}
