-- CreateEnum
CREATE TYPE "ConsultationMethod" AS ENUM ('online', 'in_person');

-- CreateEnum
CREATE TYPE "ConsultationTimeSlot" AS ENUM ('am', 'pm');

-- CreateEnum
CREATE TYPE "ConsultationBookingStatus" AS ENUM ('pending_payment', 'confirmed', 'payment_failed', 'canceled', 'completed');

-- CreateEnum
CREATE TYPE "ConsultationPaymentProvider" AS ENUM ('stripe');

-- CreateEnum
CREATE TYPE "ConsultationPaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'canceled', 'refunded');

-- CreateEnum
CREATE TYPE "ConsultantSpecialty" AS ENUM ('spatial', 'visual_styling', 'concept_design');

-- CreateTable
CREATE TABLE "consultants" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "avatar_url" TEXT,
    "bio" TEXT,
    "specialty" "ConsultantSpecialty",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consultants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_bookings" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "consultant_id" UUID,
    "source_image_id" TEXT,
    "method" "ConsultationMethod" NOT NULL,
    "consultation_date" DATE NOT NULL,
    "time_slot" "ConsultationTimeSlot" NOT NULL,
    "design_field" TEXT,
    "design_focus" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "notes" TEXT,
    "payment_consent_accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "ConsultationBookingStatus" NOT NULL DEFAULT 'pending_payment',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consultation_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" "ConsultationPaymentProvider" NOT NULL DEFAULT 'stripe',
    "stripe_price_id" TEXT NOT NULL,
    "provider_checkout_session_id" TEXT NOT NULL,
    "provider_payment_intent_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TWD',
    "status" "ConsultationPaymentStatus" NOT NULL DEFAULT 'pending',
    "checkout_expires_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "provider_refund_id" TEXT,
    "failed_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consultation_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consultation_payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "consultation_payments_currency_check" CHECK ("currency" = 'TWD')
);

-- CreateTable
CREATE TABLE "stripe_webhook_events" (
    "id" UUID NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultants_specialty_idx" ON "consultants"("specialty");

-- CreateIndex
CREATE INDEX "consultants_is_active_idx" ON "consultants"("is_active");

-- CreateIndex
CREATE INDEX "consultation_bookings_profile_id_idx" ON "consultation_bookings"("profile_id");

-- CreateIndex
CREATE INDEX "consultation_bookings_consultant_id_idx" ON "consultation_bookings"("consultant_id");

-- CreateIndex
CREATE INDEX "consultation_bookings_source_image_id_idx" ON "consultation_bookings"("source_image_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_bookings_slot_unique" ON "consultation_bookings"("consultation_date", "time_slot") WHERE "status" IN ('confirmed', 'completed');

-- CreateIndex
CREATE UNIQUE INDEX "consultation_payments_booking_id_key" ON "consultation_payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_payments_provider_checkout_session_id_key" ON "consultation_payments"("provider_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_payments_provider_payment_intent_id_key" ON "consultation_payments"("provider_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_payments_provider_refund_id_key" ON "consultation_payments"("provider_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_webhook_events_stripe_event_id_key" ON "stripe_webhook_events"("stripe_event_id");

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_consultant_id_fkey" FOREIGN KEY ("consultant_id") REFERENCES "consultants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_source_image_id_fkey" FOREIGN KEY ("source_image_id") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_payments" ADD CONSTRAINT "consultation_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "consultation_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable Row Level Security.
-- consultation_bookings and consultation_payments intentionally expose only owner SELECT
-- to authenticated clients. No client INSERT, UPDATE, or DELETE policies are created.
-- Booking creation, consultant assignment, and booking status transitions are handled by
-- the backend service using server-side Prisma/service-role access. Payment creation and
-- payment status transitions are handled by the backend payment service or Stripe webhook.
-- Booking cancellation sets status = 'canceled'; no general hard-delete flow is exposed.
ALTER TABLE "consultants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultation_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultation_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;

-- Public consultant directory: only active consultants are visible.
CREATE POLICY "consultants_public_read_active" ON "consultants"
    FOR SELECT
    TO anon, authenticated
    USING ("is_active" = true);

-- Users can only read bookings tied to their Supabase Auth profile id.
CREATE POLICY "consultation_bookings_select_own" ON "consultation_bookings"
    FOR SELECT
    TO authenticated
    USING ("profile_id" = auth.uid());

-- Users can only read payments belonging to their own bookings.
CREATE POLICY "consultation_payments_select_own" ON "consultation_payments"
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM "consultation_bookings" AS booking
            WHERE booking."id" = "consultation_payments"."booking_id"
              AND booking."profile_id" = auth.uid()
        )
    );

-- stripe_webhook_events intentionally has no anon/authenticated policies.
