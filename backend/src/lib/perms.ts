export type UserContext = {
  id: string;
  orgId: string;
  isAdmin: boolean;
  teamIds: Set<string>;
};

export type SecretContext = {
  orgId: string;
};

export type SecretAclInput = {
  principal: 'org' | 'user' | 'team';
  principalId?: string | null;
  canRead: boolean;
  canWrite: boolean;
};

export type PermissionResult = {
  read: boolean;
  write: boolean;
};

export function resolvePermissions(
  user: UserContext,
  secret: SecretContext,
  acls: SecretAclInput[],
  adminImplicit: boolean
): PermissionResult {
  if (user.orgId !== secret.orgId) {
    return { read: false, write: false };
  }

  if (user.isAdmin && adminImplicit) {
    return { read: true, write: true };
  }

  let read = false;
  let write = false;

  for (const acl of acls) {
    switch (acl.principal) {
      case 'org': {
        read = read || acl.canRead;
        write = write || acl.canWrite;
        break;
      }
      case 'user': {
        if (acl.principalId === user.id) {
          read = read || acl.canRead;
          write = write || acl.canWrite;
        }
        break;
      }
      case 'team': {
        if (acl.principalId && user.teamIds.has(acl.principalId)) {
          read = read || acl.canRead;
          write = write || acl.canWrite;
        }
        break;
      }
      default:
        break;
    }

    if (read && write) {
      return { read: true, write: true };
    }
  }

  return { read, write };
}
