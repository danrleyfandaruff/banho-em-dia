export const registrationNameMessages = {
  names_required: 'Informe o nome do pet e do tutor.',
  owner_name_required: 'Informe o nome do tutor.',
  pet_name_required: 'Informe o nome do pet.',
};

export function validateRegistrationNames(input: {
  ownerName?: unknown;
  dogName?: unknown;
}) {
  const ownerName =
    typeof input.ownerName === 'string' ? input.ownerName.trim() : '';
  const dogName = typeof input.dogName === 'string' ? input.dogName.trim() : '';
  const error: keyof typeof registrationNameMessages | null =
    !ownerName && !dogName
      ? 'names_required'
      : !ownerName
        ? 'owner_name_required'
        : !dogName
          ? 'pet_name_required'
          : null;
  return { ownerName, dogName, error };
}
