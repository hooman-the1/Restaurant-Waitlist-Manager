import { EntitySchema } from 'typeorm';

export interface RestaurantEntity {
  id: number;
  name: string;
  normalizedName: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
  slug: string;
  verified: boolean;
  createdAt: Date;
}

export interface VerificationTokenEntity {
  token: string;
  restaurantId: number;
}

export interface WaitlistEntryEntity {
  id: number;
  restaurantId: number;
  customerName: string;
  phone: string;
  normalizedPhone: string;
  activePhoneKey: string | null;
  partySize: number;
  privateStatusToken: string;
  actionReference: string;
  joinedAt: Date;
  status: string;
  resolvedAt: Date | null;
}

export const RestaurantSchema = new EntitySchema<RestaurantEntity>({
  name: 'Restaurant',
  tableName: 'restaurants',
  columns: {
    id: { type: Number, primary: true, generated: 'increment' },
    name: { type: String },
    normalizedName: { type: String, unique: true },
    email: { type: String },
    normalizedEmail: { type: String, unique: true },
    passwordHash: { type: String },
    slug: { type: String, unique: true },
    verified: { type: Boolean },
    createdAt: { type: Date },
  },
});

export const VerificationTokenSchema =
  new EntitySchema<VerificationTokenEntity>({
    name: 'VerificationToken',
    tableName: 'verification_tokens',
    columns: {
      token: { type: String, primary: true },
      restaurantId: { type: Number },
    },
  });

export const WaitlistEntrySchema = new EntitySchema<WaitlistEntryEntity>({
  name: 'WaitlistEntry',
  tableName: 'waitlist_entries',
  columns: {
    id: { type: Number, primary: true, generated: 'increment' },
    restaurantId: { type: Number },
    customerName: { type: String },
    phone: { type: String },
    normalizedPhone: { type: String },
    activePhoneKey: { type: String, nullable: true },
    partySize: { type: Number },
    privateStatusToken: { type: String, unique: true },
    actionReference: { type: String, unique: true },
    joinedAt: { type: Date },
    status: { type: String },
    resolvedAt: { type: Date, nullable: true },
  },
  uniques: [
    {
      name: 'UQ_waitlist_active_phone',
      columns: ['restaurantId', 'activePhoneKey'],
    },
  ],
  indices: [{ columns: ['restaurantId', 'status', 'joinedAt', 'id'] }],
});

export const DATABASE_ENTITIES = [
  RestaurantSchema,
  VerificationTokenSchema,
  WaitlistEntrySchema,
];
