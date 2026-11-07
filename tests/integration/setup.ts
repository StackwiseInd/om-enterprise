import "dotenv/config";

// Point the application's DB singleton at the test database before any module uses it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_SECRET ??= "test-secret-test-secret-test-secret";

// Tests never use real payment credentials, even when a developer has them in .env: a test that needs Razorpay
// sets its own fake keys and talks to a stand-in (tests/support/fake-razorpay.ts).
for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) delete process.env[k];
