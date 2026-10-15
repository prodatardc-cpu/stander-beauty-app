// Preloaded by "npm test": compiles TypeScript on the fly and points the API at a dedicated
// test database, so the development database is never touched by the test suite.
const path = require('node:path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ project: path.join(root, 'tsconfig.test.json'), transpileOnly: true });
require('dotenv').config({ path: process.env.ENV_FILE ?? path.join(root, '.env'), quiet: true });

const testDatabase = process.env.TEST_DB_NAME || `${process.env.DB_NAME || 'salon_coiffure'}_test`;
if (!/^\w+_test$/.test(testDatabase)) {
  throw new Error(`Refusing to run the tests against "${testDatabase}": the test database name must end with "_test".`);
}

// Also loaded by every test process that "node --test" spawns: they inherit TEST_DB_NAME, so the
// name is computed once instead of being suffixed again.
process.env.TEST_DB_NAME = testDatabase;
process.env.DB_NAME = testDatabase;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
process.env.JWT_EXPIRE = '1h';
process.env.CORS_ORIGIN = 'http://localhost:5173';
