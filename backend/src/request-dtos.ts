import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { ApiClosedSchema, FinalStatus } from './api-contract-models';

@ApiClosedSchema('RestaurantSignupInput')
export class RestaurantSignupDto {
  @ApiProperty({
    example: 'Demo Restaurant',
    minLength: 1,
    description:
      'Trimmed by the backend with repeated internal whitespace collapsed; unique case-insensitively.',
  })
  @IsString()
  @IsNotEmpty()
  restaurantName!: string;

  @ApiProperty({
    example: 'owner@example.com',
    format: 'email',
    description: 'Unique restaurant email address.',
  })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: 'correct-horse',
    format: 'password',
    minLength: 8,
    writeOnly: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}

@ApiClosedSchema('VerificationInput')
export class RestaurantVerificationDto {
  @ApiProperty({
    example: 'verification-opaque-token',
    minLength: 1,
    description:
      'Single-use, non-expiring verification token from the verification link.',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

@ApiClosedSchema('JoinWaitlistInput')
export class JoinWaitlistDto {
  @ApiProperty({
    example: 'Morgan Lee',
    minLength: 1,
    description: 'Preserved as entered; duplicate names are allowed.',
  })
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @ApiProperty({
    example: '(555) 010-1000',
    minLength: 1,
    description:
      'Basic phone number; spaces, dashes, and parentheses are ignored for duplicate detection.',
  })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 30, type: 'integer' })
  @IsInt()
  @Min(1)
  @Max(30)
  partySize!: number;
}

@ApiClosedSchema('StaffResolutionInput')
export class StaffResolutionDto {
  @ApiProperty({
    enum: FinalStatus,
    enumName: 'FinalStatus',
  })
  @IsIn(['seated', 'cancelled', 'no-show'])
  resolution!: FinalStatus;
}
