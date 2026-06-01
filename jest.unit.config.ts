export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/libs/domain/src/$1',
    '^@application/(.*)$': '<rootDir>/libs/application/src/$1',
    '^@contracts/(.*)$': '<rootDir>/libs/contracts/src/$1',
    '^@infrastructure/(.*)$': '<rootDir>/libs/infrastructure/src/$1',
    '^@shared/(.*)$': '<rootDir>/libs/shared/src/$1',
  },
  testMatch: ['**/*.spec.ts'],
};
