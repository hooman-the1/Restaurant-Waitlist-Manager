import { ApiProperty, ApiSchema } from '@nestjs/swagger';

const closedSchemaNames = new Set<string>();

export function ApiClosedSchema(name: string): ClassDecorator {
  const schemaDecorator = ApiSchema({ name });
  return (target) => {
    schemaDecorator(target);
    closedSchemaNames.add(name);
  };
}

export function applyClosedSchemaMetadata(
  schemas: Record<string, unknown>,
): void {
  for (const name of closedSchemaNames) {
    const schema = schemas[name];
    if (typeof schema === 'object' && schema !== null) {
      (schema as Record<string, unknown>).additionalProperties = false;
    }
  }
}

export enum FinalStatus {
  Seated = 'seated',
  Cancelled = 'cancelled',
  NoShow = 'no-show',
}

@ApiClosedSchema('Success')
export class SuccessResponse {
  @ApiProperty({ type: 'string', enum: ['success'] })
  kind!: 'success';
}

@ApiClosedSchema('ValidationFailure')
export class ValidationFailureResponse {
  @ApiProperty({ type: 'string', enum: ['validation'] })
  kind!: 'validation';

  @ApiProperty({ example: 'Party size must be an integer from 1 to 30.' })
  message!: string;
}

@ApiClosedSchema('UnauthorizedFailure')
export class UnauthorizedFailureResponse {
  @ApiProperty({ type: 'string', enum: ['unauthorized'] })
  kind!: 'unauthorized';
}

@ApiClosedSchema('NotFoundFailure')
export class NotFoundFailureResponse {
  @ApiProperty({ type: 'string', enum: ['not-found'] })
  kind!: 'not-found';
}

@ApiClosedSchema('UnexpectedFailure')
export class UnexpectedFailureResponse {
  @ApiProperty({ type: 'string', enum: ['unexpected'] })
  kind!: 'unexpected';

  @ApiProperty({
    type: 'string',
    enum: ['Something went wrong. Please try again.'],
  })
  message!: 'Something went wrong. Please try again.';
}

@ApiClosedSchema('InvalidOrUsedVerificationTokenFailure')
export class InvalidOrUsedVerificationTokenFailureResponse {
  @ApiProperty({ type: 'string', enum: ['invalid-or-used-token'] })
  kind!: 'invalid-or-used-token';
}

@ApiClosedSchema('DashboardAccessAllowed')
export class DashboardAccessAllowedResponse {
  @ApiProperty({ type: 'string', enum: ['allowed'] })
  kind!: 'allowed';
}

@ApiClosedSchema('PublicRestaurantView')
export class PublicRestaurantViewResponse {
  @ApiProperty({ example: 'Demo Restaurant' })
  restaurantName!: string;
}

@ApiClosedSchema('PublicWaitlistLookupSuccess')
export class PublicWaitlistLookupSuccessResponse {
  @ApiProperty({ type: 'string', enum: ['success'] })
  kind!: 'success';

  @ApiProperty({ type: () => PublicRestaurantViewResponse })
  restaurant!: PublicRestaurantViewResponse;
}

@ApiClosedSchema('JoinWaitlistSuccess')
export class JoinWaitlistSuccessResponse {
  @ApiProperty({ type: 'string', enum: ['success'] })
  kind!: 'success';

  @ApiProperty({
    minLength: 1,
    description:
      "Unguessable token used to construct the customer's private status URL.",
    example: '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44',
  })
  privateStatusToken!: string;
}

@ApiClosedSchema('DuplicatePhoneFailure')
export class DuplicatePhoneFailureResponse {
  @ApiProperty({ type: 'string', enum: ['duplicate-phone'] })
  kind!: 'duplicate-phone';

  @ApiProperty({
    type: 'string',
    enum: ['This phone number is already on the waitlist.'],
  })
  message!: 'This phone number is already on the waitlist.';
}

@ApiClosedSchema('ActivePrivateStatusView')
export class ActivePrivateStatusViewResponse {
  @ApiProperty({ type: 'string', enum: ['active'] })
  kind!: 'active';

  @ApiProperty({ example: 'Demo Restaurant' })
  restaurantName!: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 1 })
  position!: number;
}

@ApiClosedSchema('ResolvedPrivateStatusView')
export class ResolvedPrivateStatusViewResponse {
  @ApiProperty({ type: 'string', enum: ['resolved'] })
  kind!: 'resolved';

  @ApiProperty({ example: 'Demo Restaurant' })
  restaurantName!: string;

  @ApiProperty({ enum: FinalStatus, enumName: 'FinalStatus' })
  finalStatus!: FinalStatus;
}

@ApiClosedSchema('CancellationSuccess')
export class CancellationSuccessResponse {
  @ApiProperty({ type: 'string', enum: ['cancelled'] })
  kind!: 'cancelled';
}

@ApiClosedSchema('ActiveDashboardEntry')
export class ActiveDashboardEntryResponse {
  @ApiProperty({ type: 'integer', minimum: 1, example: 1 })
  position!: number;

  @ApiProperty({ example: 'Morgan Lee' })
  customerName!: string;

  @ApiProperty({ example: '(555) 010-1000' })
  phone!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 30, example: 6 })
  partySize!: number;

  @ApiProperty({
    minLength: 1,
    description:
      'Opaque staff action reference; never expose it on customer-facing pages.',
    example: '9c777a3d-b7ed-4c86-95ce-7f456a62ff11',
  })
  actionReference!: string;
}

@ApiClosedSchema('ResolvedDashboardEntry')
export class ResolvedDashboardEntryResponse {
  @ApiProperty({ example: 'Alex Chen' })
  customerName!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 30, example: 4 })
  partySize!: number;

  @ApiProperty({ enum: FinalStatus, enumName: 'FinalStatus' })
  finalStatus!: FinalStatus;
}

@ApiClosedSchema('DashboardView')
export class DashboardViewResponse {
  @ApiProperty({ example: 'Demo Restaurant' })
  restaurantName!: string;

  @ApiProperty({
    type: () => [ActiveDashboardEntryResponse],
    description:
      'Active entries in strict FIFO order with one-based positions.',
  })
  activeEntries!: ActiveDashboardEntryResponse[];

  @ApiProperty({
    type: () => [ResolvedDashboardEntryResponse],
    description: 'Entries resolved during the current server-local day.',
  })
  resolvedToday!: ResolvedDashboardEntryResponse[];
}

@ApiClosedSchema('DashboardLoadSuccess')
export class DashboardLoadSuccessResponse {
  @ApiProperty({ type: 'string', enum: ['success'] })
  kind!: 'success';

  @ApiProperty({ type: () => DashboardViewResponse })
  dashboard!: DashboardViewResponse;
}

export const RESPONSE_MODELS = Object.freeze({
  Success: SuccessResponse,
  ValidationFailure: ValidationFailureResponse,
  UnauthorizedFailure: UnauthorizedFailureResponse,
  NotFoundFailure: NotFoundFailureResponse,
  UnexpectedFailure: UnexpectedFailureResponse,
  InvalidOrUsedVerificationTokenFailure:
    InvalidOrUsedVerificationTokenFailureResponse,
  DashboardAccessAllowed: DashboardAccessAllowedResponse,
  PublicRestaurantView: PublicRestaurantViewResponse,
  PublicWaitlistLookupSuccess: PublicWaitlistLookupSuccessResponse,
  JoinWaitlistSuccess: JoinWaitlistSuccessResponse,
  DuplicatePhoneFailure: DuplicatePhoneFailureResponse,
  ActivePrivateStatusView: ActivePrivateStatusViewResponse,
  ResolvedPrivateStatusView: ResolvedPrivateStatusViewResponse,
  CancellationSuccess: CancellationSuccessResponse,
  ActiveDashboardEntry: ActiveDashboardEntryResponse,
  ResolvedDashboardEntry: ResolvedDashboardEntryResponse,
  DashboardView: DashboardViewResponse,
  DashboardLoadSuccess: DashboardLoadSuccessResponse,
});
