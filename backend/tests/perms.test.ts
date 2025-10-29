import { describe, expect, it } from 'vitest';
import { resolvePermissions } from '../src/lib/perms';

function createUser(overrides?: Partial<Parameters<typeof resolvePermissions>[0]>) {
  return {
    id: 'user-1',
    orgId: 'org-1',
    isAdmin: false,
    teamIds: new Set<string>(),
    ...(overrides ?? {})
  };
}

const baseSecret = { orgId: 'org-1' };

describe('resolvePermissions', () => {
  it('denies access when user is in different org', () => {
    const user = createUser({ orgId: 'org-2' });
    const perms = resolvePermissions(user, baseSecret, [], true);
    expect(perms).toEqual({ read: false, write: false });
  });

  it('returns no permissions when no ACLs match', () => {
    const user = createUser();
    const perms = resolvePermissions(user, baseSecret, [], false);
    expect(perms).toEqual({ read: false, write: false });
  });

  it('grants read/write when org ACL allows it', () => {
    const user = createUser();
    const perms = resolvePermissions(
      user,
      baseSecret,
      [
        {
          principal: 'org' as const,
          canRead: true,
          canWrite: true
        }
      ],
      false
    );
    expect(perms).toEqual({ read: true, write: true });
  });

  it('grants user-specific write access', () => {
    const user = createUser();
    const perms = resolvePermissions(
      user,
      baseSecret,
      [
        {
          principal: 'user' as const,
          principalId: user.id,
          canRead: false,
          canWrite: true
        }
      ],
      false
    );
    expect(perms).toEqual({ read: false, write: true });
  });

  it('grants team access only to members', () => {
    const teamId = 'team-1';
    const member = createUser({ teamIds: new Set([teamId]) });
    const nonMember = createUser();

    const acls = [
      {
        principal: 'team' as const,
        principalId: teamId,
        canRead: true,
        canWrite: false
      }
    ];

    const memberPerms = resolvePermissions(member, baseSecret, acls, false);
    const nonMemberPerms = resolvePermissions(nonMember, baseSecret, acls, false);

    expect(memberPerms).toEqual({ read: true, write: false });
    expect(nonMemberPerms).toEqual({ read: false, write: false });
  });

  it('unions permissions across matching ACLs', () => {
    const teamId = 'team-2';
    const user = createUser({ teamIds: new Set([teamId]) });

    const perms = resolvePermissions(
      user,
      baseSecret,
      [
        {
          principal: 'team' as const,
          principalId: teamId,
          canRead: true,
          canWrite: false
        },
        {
          principal: 'user' as const,
          principalId: user.id,
          canRead: false,
          canWrite: true
        }
      ],
      false
    );

    expect(perms).toEqual({ read: true, write: true });
  });

  it('grants full access to admins when implicit is enabled', () => {
    const user = createUser({ isAdmin: true });
    const perms = resolvePermissions(user, baseSecret, [], true);
    expect(perms).toEqual({ read: true, write: true });
  });

  it('does not grant implicit access when adminImplicit is disabled', () => {
    const user = createUser({ isAdmin: true });
    const perms = resolvePermissions(user, baseSecret, [], false);
    expect(perms).toEqual({ read: false, write: false });
  });
});
