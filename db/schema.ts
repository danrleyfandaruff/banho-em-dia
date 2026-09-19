import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const appointments = sqliteTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    customerPetName: text('customer_pet_name').notNull().default(''),
    ownerName: text('owner_name').notNull().default(''),
    dogName: text('dog_name').notNull().default(''),
    whatsapp: text('whatsapp').notNull().default(''),
    cpf: text('cpf').notNull().default(''),
    paymentMethod: text('payment_method').notNull().default(''),
    paymentDetails: text('payment_details'),
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

export const appUsers = sqliteTable(
  'app_users',
  {
    id: text('id').primaryKey(),
    chatgptUserId: text('chatgpt_user_id'),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    role: text('role').notNull().default('staff'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by').notNull().default(''),
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (table) => [
    uniqueIndex('idx_app_users_email').on(table.email),
    uniqueIndex('idx_app_users_chatgpt_user_id').on(table.chatgptUserId),
    index('idx_app_users_active').on(table.active),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').notNull().default(''),
    actorEmail: text('actor_email').notNull().default(''),
    actorName: text('actor_name').notNull().default(''),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull().default(''),
    description: text('description').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_audit_logs_created_at').on(table.createdAt)],
);
