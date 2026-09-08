import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    customerPetName: text('customer_pet_name').notNull().default(''),
    ownerName: text('owner_name').notNull().default(''),
    dogName: text('dog_name').notNull().default(''),
    whatsapp: text('whatsapp').notNull().default(''),
    planType: text('plan_type').notNull(),
    amountCents: integer('amount_cents'),
    paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
    scheduledDate: text('scheduled_date').notNull(),
    scheduledTime: text('scheduled_time').notNull().default('09:00'),
    status: text('status').notNull().default('scheduled'),
    services: text('services').notNull().default('[]'),
    sessionNumber: integer('session_number').notNull().default(1),
    totalSessions: integer('total_sessions').notNull().default(1),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_appointments_scheduled_date').on(table.scheduledDate),
    index('idx_appointments_group_id').on(table.groupId),
    index('idx_appointments_status_date').on(table.status, table.scheduledDate),
  ],
);
