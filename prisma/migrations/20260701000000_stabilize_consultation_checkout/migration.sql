ALTER TABLE "consultation_bookings"
ADD COLUMN "idempotency_key" UUID;

UPDATE "consultation_bookings"
SET "idempotency_key" = "id"
WHERE "idempotency_key" IS NULL;

ALTER TABLE "consultation_bookings"
ALTER COLUMN "idempotency_key" SET NOT NULL;

ALTER TABLE "consultation_payments"
ALTER COLUMN "provider_checkout_session_id" DROP NOT NULL;

CREATE UNIQUE INDEX "consultation_bookings_profile_id_idempotency_key_key"
ON "consultation_bookings"("profile_id", "idempotency_key");
