const value = process.env.EDUMARKET_TEST_MONGO_URI;
if (!value) throw new Error('Set EDUMARKET_TEST_MONGO_URI to an isolated local MongoDB database ending in _test.');
const uri = new URL(value);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname) || !/_test$/i.test(uri.pathname)) {
  throw new Error('Integration tests only run against a local database whose name ends in _test.');
}
