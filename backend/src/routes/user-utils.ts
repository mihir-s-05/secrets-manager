import type { PrismaClient } from '@prisma/client';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type UserResponse = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  org: {
    id: string;
    name: string;
  };
  teams: Array<{
    id: string;
    name: string;
  }>;
};

export async function loadUserWithOrgAndTeams(prisma: PrismaClient | TransactionClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      org: true,
      memberships: {
        include: {
          team: true
        }
      }
    }
  });

  if (!user) {
    return null;
  }

  const teams = user.memberships.map((membership) => membership.team);

  const response: UserResponse = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    org: {
      id: user.org.id,
      name: user.org.name
    },
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name
    }))
  };

  return { user, response, teamIds: teams.map((team) => team.id) };
}

