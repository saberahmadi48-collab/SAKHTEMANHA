/**
 * Jest setup for the e2e suite.
 *
 * Loads apps/api/.env BEFORE any module reads process.env. ConfigModule would
 * do this itself, but PrismaClient is constructed from DATABASE_URL at import
 * time in some paths, and validateEnv runs during AppModule construction — both
 * happen before a test body executes, so waiting for Nest is too late.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '..', '.env') });

// Tests assert on HTTP status codes and Persian messages, not on log output.
// Nest's bootstrap logging would otherwise bury the reporter in noise.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
