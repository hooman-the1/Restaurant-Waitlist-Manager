import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class RestaurantSignupDto {
  @IsString()
  @IsNotEmpty()
  restaurantName!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}

export class RestaurantVerificationDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class JoinWaitlistDto {
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsInt()
  @Min(1)
  @Max(30)
  partySize!: number;
}

export class StaffResolutionDto {
  @IsIn(['seated', 'cancelled', 'no-show'])
  resolution!: 'seated' | 'cancelled' | 'no-show';
}
