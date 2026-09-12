import { InMemoryStore } from './in-memory-store';
import {
  generateActionReference,
  generatePrivateStatusToken,
  generateRestaurantSlug,
  generateRestaurantVerificationToken,
  normalizeEmailForComparison,
  normalizePhoneForComparison,
  normalizeRestaurantDisplayName,
  normalizeRestaurantNameForComparison,
} from './domain-utilities';

describe('restaurant name utilities', () => {
  it.each([
    ['  The\t \nGarden  ', 'The Garden'],
    ['', ''],
    [' \t\r\n ', ''],
    ['\u00a0Café\u2003Grill\u00a0', 'Café Grill'],
    ['  Café 😀, Inc.  ', 'Café 😀, Inc.'],
  ])(
    'normalizes display name %p without changing visible characters',
    (input, expected) => {
      expect(normalizeRestaurantDisplayName(input)).toBe(expected);
    },
  );

  it('normalizes restaurant names for locale-independent comparison', () => {
    expect(normalizeRestaurantNameForComparison('  THE   Garden ')).toBe(
      'the garden',
    );
    expect(normalizeRestaurantNameForComparison('the garden')).toBe(
      'the garden',
    );
    expect(normalizeRestaurantNameForComparison(' ÉCOLE! ')).toBe('école!');
  });
});

describe('email comparison', () => {
  it('lowercases and trims only outer whitespace', () => {
    expect(normalizeEmailForComparison(' Owner@Example.COM ')).toBe(
      'owner@example.com',
    );
    expect(normalizeEmailForComparison(' First.Last+Tag @Example.COM ')).toBe(
      'first.last+tag @example.com',
    );
    expect(normalizeEmailForComparison(' \t\n ')).toBe('');
  });
});

describe('restaurant slug generation', () => {
  it.each([
    ['  Demo   Restaurant ', 'demo-restaurant'],
    ['Café & Grill', 'café-grill'],
    ['رستوران خوب', 'رستوران-خوب'],
    ['A---B', 'a-b'],
    ['***', ''],
    ['---Leading and trailing---', 'leading-and-trailing'],
    ['A _ / B', 'a-b'],
  ])('creates the exact Unicode-aware slug for %p', (input, expected) => {
    expect(generateRestaurantSlug(input)).toBe(expected);
  });

  it('uses canonical NFC normalization and deterministic collision output', () => {
    expect(generateRestaurantSlug('Cafe\u0301')).toBe('café');
    expect(generateRestaurantSlug('A & B')).toBe('a-b');
    expect(generateRestaurantSlug('A---B')).toBe('a-b');
    expect(generateRestaurantSlug('  A\tB  ')).toBe(
      generateRestaurantSlug('A B'),
    );
  });
});

describe('phone comparison', () => {
  it.each([
    ['(555) 010-1000', '5550101000'],
    ['+1 (555) 010-1000', '+15550101000'],
    ['555.010\t–1000', '555.010\t–1000'],
    [' ( - ) ', ''],
    ['+44.20\t1234\u00a0–5678', '+44.20\t1234\u00a0–5678'],
  ])(
    'removes only the four ASCII formatting characters from %p',
    (input, expected) => {
      expect(normalizePhoneForComparison(input)).toBe(expected);
    },
  );
});

describe('display-value preservation', () => {
  it('stores original customer values beside a derived phone comparison value', () => {
    const store = new InMemoryStore();
    const restaurant = store.createRestaurant({
      name: 'Demo',
      normalizedName: 'demo',
      email: 'demo@example.test',
      normalizedEmail: 'demo@example.test',
      passwordHash: 'hash',
      slug: 'demo',
      verified: true,
      createdAt: new Date(2026, 8, 12),
    });
    const customerName = 'Zoë 😀';
    const displayedPhone = '+1 (555)\t010–1000';

    const entry = store.createWaitlistEntry({
      restaurantId: restaurant.id,
      customerName,
      phone: displayedPhone,
      normalizedPhone: normalizePhoneForComparison(displayedPhone),
      partySize: 2,
      privateStatusToken: 'private',
      actionReference: 'action',
      joinedAt: new Date(2026, 8, 12),
      status: 'active',
    });

    expect(entry.customerName).toBe(customerName);
    expect(entry.phone).toBe(displayedPhone);
    expect(entry.normalizedPhone).toBe('+1555\t010–1000');
  });
});

describe('opaque reference generation', () => {
  const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it.each([
    generateRestaurantVerificationToken,
    generatePrivateStatusToken,
    generateActionReference,
  ])('generates a non-empty canonical UUID v4 by default', (generate) => {
    expect(generate()).toMatch(uuidV4Pattern);
  });

  it.each([
    generateRestaurantVerificationToken,
    generatePrivateStatusToken,
    generateActionReference,
  ])('returns one injected UUID and calls its source once', (generate) => {
    const expected = '123e4567-e89b-42d3-a456-426614174000';
    const source = jest.fn(() => expected);

    expect(generate(source)).toBe(expected);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('does not cache values across capability types', () => {
    const source = jest
      .fn()
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');

    expect([
      generateRestaurantVerificationToken(source),
      generatePrivateStatusToken(source),
      generateActionReference(source),
    ]).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(source).toHaveBeenCalledTimes(3);
  });
});
