import { createApplication } from './application';

describe('createApplication', () => {
  it('fails before creating a listening application when the secret is absent', async () => {
    const previousSecret = process.env.SECRET_KEY;
    delete process.env.SECRET_KEY;

    try {
      await expect(createApplication()).rejects.toThrow(
        'Configuration error: SECRET_KEY is required.',
      );
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SECRET_KEY;
      } else {
        process.env.SECRET_KEY = previousSecret;
      }
    }
  });
});
