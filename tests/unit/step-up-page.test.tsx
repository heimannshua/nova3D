import {beforeEach, describe, expect, it, vi} from 'vitest';

// The step-up page (Story 1.4b, and Story 1.11 for administration) with a fake gate. The page is the Server Component
// that turns `?for=<class>` into the form; this is where a class that is not on the list, and a class that is not the
// person's to start, becomes a page that does not exist.
class NotFound extends Error {}
const mocks = vi.hoisted(() => ({requireActiveAccount: vi.fn()}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound('not found');
  },
  redirect: () => {
    throw new Error('redirect');
  },
}));
vi.mock('@/lib/auth', () => ({requireActiveAccount: mocks.requireActiveAccount}));
vi.mock('@/app/step-up/actions', () => ({beginStepUp: Object.assign(async () => ({outcome: 'idle'}), {bind: () => async () => ({outcome: 'idle'})})}));

import StepUpPage from '@/app/step-up/page';
import {stepUpClasses, stepUpReturnPaths, type StepUpClass} from '@/lib/step-up';

const active = (role: 'administrator' | 'member') => ({
  state: 'active',
  user: {id: '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44', email: 'person@example.com', sessionId: '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11'},
  account: {accountId: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', workspaceId: null, role, epoch: 1, preferences: null},
});
const render = async (requested: string | string[] | undefined) => {
  try {
    return await StepUpPage({searchParams: Promise.resolve({for: requested})});
  } catch (error) {
    if (error instanceof NotFound) return 'not-found' as const;
    throw error;
  }
};

beforeEach(() => {
  mocks.requireActiveAccount.mockReset();
});

describe('the step-up page', () => {
  it.each(stepUpClasses)('is the Administrator\'s to open for %s, with the class\'s own way back and their address', async (actionClass) => {
    mocks.requireActiveAccount.mockResolvedValue(active('administrator'));
    const page = await render(actionClass);
    expect(page).not.toBe('not-found');
    const props = (page as {props: {cancelHref: string; actionClass: StepUpClass; email: string}}).props;
    expect(props).toMatchObject({cancelHref: stepUpReturnPaths[actionClass], actionClass, email: 'person@example.com'});
  });

  it('is a page that does not exist for a member who asks for administration, which would lead them to a page that answers 404', async () => {
    mocks.requireActiveAccount.mockResolvedValue(active('member'));
    expect(await render('administration')).toBe('not-found');
    expect(await render(['administration', 'owner_deletion'])).toBe('not-found');
  });

  it.each(['owner_deletion', 'account_deletion', 'close_instance'] as const)('is still a member\'s to open for %s', async (actionClass) => {
    mocks.requireActiveAccount.mockResolvedValue(active('member'));
    const page = await render(actionClass);
    expect(page).not.toBe('not-found');
    expect((page as {props: {actionClass: string}}).props.actionClass).toBe(actionClass);
  });

  it.each([undefined, '', 'Administration', 'admin', 'delete_everything', '__proto__', 'administration '])('is a page that does not exist for %j, for anyone', async (requested) => {
    for (const role of ['administrator', 'member'] as const) {
      mocks.requireActiveAccount.mockResolvedValue(active(role));
      expect(await render(requested as string | undefined), `${role} ${String(requested)}`).toBe('not-found');
    }
  });

  it('asks for an active Account first: nothing is decided about the class before the gate has answered', async () => {
    mocks.requireActiveAccount.mockRejectedValue(new Error('redirect'));
    await expect(render('administration')).rejects.toThrow('redirect');
  });
});
