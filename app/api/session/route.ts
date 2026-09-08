import { authorize, getIdentity } from '@/lib/auth';

export async function GET(request: Request) {
  const identity = getIdentity(request);
  if (!identity) return Response.json({ status: 'signed_out' }, { status: 401 });

  const user = await authorize(request);
  if (!user) {
    return Response.json({ status: 'forbidden', email: identity.email }, { status: 403 });
  }

  return Response.json({
    status: 'authorized',
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
