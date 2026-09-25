import type { PaymentBreakdown } from './payment';

export type PlanType = 'monthly' | 'fortnightly' | 'single';
export type Status = 'scheduled' | 'completed' | 'absent';
export type PaymentMethod = '' | 'pix' | 'cash' | 'debit' | 'credit';

export type Appointment = {
  id: string;
  groupId: string;
  clientId: string | null;
  petId: string | null;
  customerPetName: string;
  ownerName: string;
  dogName: string;
  whatsapp: string;
  cpf: string;
  paymentMethod: PaymentMethod;
  paymentDetails: PaymentBreakdown | null;
  planType: PlanType;
  amountCents: number | null;
  paid: boolean;
  scheduledDate: string;
  scheduledTime: string;
  status: Status;
  services: string[];
  sessionNumber: number;
  totalSessions: number;
};

export type PetProfile = {
  key: string;
  clientId: string | null;
  petId: string | null;
  ownerName: string;
  dogName: string;
  whatsapp: string;
  cpf: string;
  favoriteServices: string[];
  lastTime: string;
  lastAmountCents: number | null;
  notes: string;
};
