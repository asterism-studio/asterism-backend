DROP INDEX "consultation_bookings_profile_id_idx";

CREATE INDEX "consultation_bookings_profile_date_slot_id_idx"
ON "consultation_bookings"("profile_id", "consultation_date", "time_slot", "id");
