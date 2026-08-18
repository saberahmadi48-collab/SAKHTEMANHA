/**
 * Public surface of the shared contracts package.
 * Anything exported here is consumed by BOTH the NestJS API and the Next.js
 * client, so it must stay free of runtime dependencies (no Prisma, no Nest).
 */
export * from './permissions';
export * from './scope';
