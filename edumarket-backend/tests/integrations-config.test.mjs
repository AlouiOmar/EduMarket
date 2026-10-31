import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// No provider, LTI key or SCORM origin configured: each integration must say it is not operational (nothing simulated).
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unused_test';
process.env.JWT_SECRET ||= 'test-secret-must-contain-more-than-32-characters';
for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'LTI_PRIVATE_KEY', 'LTI_KEY_ID', 'LTI_ISSUER', 'SCORM_CONTENT_ORIGIN']) delete process.env[key];
const { aiStatus, chat } = await import('../dist/integrations/aiProvider.js');
const { ltiConfigured, platformJwks } = await import('../dist/modules/lti/keys.js');
const { scormConfigured } = await import('../dist/modules/scorm/routes.js');

describe('integrations without configuration', () => {
  test('AI: not configured, no simulated answer', async () => {
    assert.deepEqual(aiStatus(), { configured: false, provider: 'none', model: null });
    await assert.rejects(chat('system', [{ role: 'user', content: 'Bonjour' }]), error => error.code === 'AI_PROVIDER_NOT_CONFIGURED' && error.status === 503);
  });
  test('LTI: no key, no JWKS, no launch', () => {
    assert.equal(ltiConfigured(), false);
    assert.throws(() => platformJwks(), error => error.code === 'LTI_NOT_CONFIGURED');
  });
  test('SCORM: no isolated content origin, no launch', () => {
    assert.equal(scormConfigured(), false);
  });
});
