import 'dotenv/config'

// Every test file talks to the test database, as the application role.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL
