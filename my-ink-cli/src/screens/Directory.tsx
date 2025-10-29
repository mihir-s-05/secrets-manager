import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {Key} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import Spinner from '../components/Spinner.js';
import KeyLegend from '../components/KeyLegend.js';
import Modal from '../components/Modal.js';
import {List} from '../components/List.js';
import {useAppServices} from '../app/App.js';
import {useRouter} from '../app/Router.js';
import {
  addTeamMember,
  createTeam,
  createUser,
  fetchTeams,
  fetchUsers,
  removeTeamMember,
  deleteTeam,
  deleteUser,
  setAdmin
} from '../api/directory.js';
import type {Team, User} from '../types/dto.js';

interface DirectoryProps {
  defaultTab?: 'users' | 'teams';
}

type TabKey = 'teams' | 'users';

type ModalState =
  | {kind: 'createTeam'}
  | {kind: 'createUser'}
  | {kind: 'addMember'; team: Team}
  | {kind: 'teamConfig'; teamId: string}
  | {kind: 'userConfig'; userId: string}
  | null;

type FocusArea = 'teams' | 'members' | 'users';

const Directory: React.FC<DirectoryProps> = ({defaultTab = 'teams'}) => {
  const {client, notify, session, setEditing, setEscapeHandler} = useAppServices();
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>(defaultTab);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [focusArea, setFocusArea] = useState<FocusArea>(defaultTab === 'teams' ? 'teams' : 'users');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const isAdmin = session.user?.isAdmin ?? false;

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const [teamResult, userResult] = await Promise.all([fetchTeams(client), fetchUsers(client)]);
      setTeams(teamResult);
      setUsers(userResult);
      setSelectedTeamId((prev) => {
        if (prev && teamResult.some((team) => team.id === prev)) {
          return prev;
        }
        return teamResult[0]?.id ?? null;
      });
    } catch (err) {
      notify(`Unable to load directory: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    setEditing(false);
    setEscapeHandler(() => {
      router.pop();
      return true;
    });
    loadDirectory().catch(() => undefined);
    return () => {
      setEscapeHandler(null);
    };
  }, [loadDirectory, router, setEditing, setEscapeHandler]);

  // Suppress global shortcuts while any modal is open (text entry or selection)
  useEffect(() => {
    setEditing(!!modal);
  }, [modal, setEditing]);

  useEffect(() => {
    // Reset member selection when team changes
    const members = teams.find((team) => team.id === selectedTeamId)?.members ?? [];
    setSelectedMemberId(members[0]?.id ?? null);
  }, [selectedTeamId, teams]);

  useEffect(() => {
    // Default to first user when list loads
    if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  useInput((input: string, key: Key) => {
    if (modal) {
      if (key.escape) {
        setModal(null);
      }
      return;
    }

    if (key.leftArrow) {
      setTab('teams');
      setFocusArea('teams');
      return;
    }
    if (key.rightArrow) {
      setTab('users');
      setFocusArea('users');
      return;
    }

    if (key.tab) {
      if (tab === 'teams') {
        setFocusArea((prev) => (prev === 'teams' ? 'members' : 'teams'));
      } else {
        setFocusArea('users');
      }
      return;
    }

    if (input === 'r') {
      loadDirectory().catch(() => undefined);
      return;
    }

    if (!isAdmin) {
      return;
    }

    if (tab === 'teams') {
      if (input === 't') {
        setModal({kind: 'createTeam'});
        return;
      }
      if (input === 'u') {
        setModal({kind: 'createUser'});
        return;
      }
      // Editing is handled via Enter → config modal
    } else if (tab === 'users' && input === 'u') {
      setModal({kind: 'createUser'});
    }
  });

  const handleCreateTeam = async (name: string) => {
    if (!name.trim()) {
      notify('Team name cannot be empty.', 'error');
      return;
    }
    setWorking(true);
    try {
      await createTeam(client, {name: name.trim()});
      notify(`Team '${name.trim()}' created`, 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to create team: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleCreateUser = async (displayName: string, email: string) => {
    if (!displayName.trim() || !email.trim()) {
      notify('Display name and email are required.', 'error');
      return;
    }
    setWorking(true);
    try {
      await createUser(client, {displayName: displayName.trim(), email: email.trim()});
      notify(`User '${displayName.trim()}' invited`, 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to create user: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleAddMember = async (team: Team, userId: string) => {
    setWorking(true);
    try {
      await addTeamMember(client, team.id, userId);
      notify(`Added member to ${team.name}`, 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to add member: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleRemoveMember = async (team: Team, userId: string) => {
    setWorking(true);
    try {
      await removeTeamMember(client, team.id, userId);
      notify(`Removed member from ${team.name}`, 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to remove member: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
    }
  };

  const teamMembers = useMemo(() => {
    if (!selectedTeamId) return [] as Array<{id: string; label: string}>;
    const team = teams.find((entry) => entry.id === selectedTeamId);
    if (!team?.members) return [] as Array<{id: string; label: string}>;
    return team.members.map((member) => ({
      id: member.id,
      label: member.displayName ?? member.email ?? member.id
    }));
  }, [selectedTeamId, teams]);

  if (loading) {
    return <Spinner label="Loading directory" />;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2}>
        <Text color={tab === 'teams' ? 'cyan' : undefined}>Teams</Text>
        <Text color={tab === 'users' ? 'cyan' : undefined}>Users</Text>
      </Box>

      {tab === 'teams' ? (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" width="50%">
            <Text color="gray">Teams</Text>
            <List
              isActive={focusArea === 'teams'}
              items={teams}
              itemKey={(team) => team.id}
              onHighlight={(team) => {
                setSelectedTeamId(team.id);
              }}
              onSubmit={(team) => setModal({kind: 'teamConfig', teamId: team.id})}
              renderItem={({item, isHighlighted}) => (
                <Box flexDirection="column">
                  <Text color={isHighlighted ? 'cyan' : undefined}>{item.name}</Text>
                  <Text color="gray">Members: {item.members?.length ?? 0}</Text>
                </Box>
              )}
              emptyMessage="No teams found"
            />
          </Box>
          <Box flexDirection="column" width="50%">
            <Text color="gray">Members</Text>
            <List
              isActive={focusArea === 'members'}
              items={teamMembers}
              itemKey={(member) => member.id}
              onHighlight={(member) => setSelectedMemberId(member.id)}
              renderItem={({item, isHighlighted}) => (
                <Text color={isHighlighted ? 'cyan' : undefined}>{item.label}</Text>
              )}
              emptyMessage="Select a team to view members"
            />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column" width="50%">
            <Text color="gray">Users</Text>
            <List
              isActive={focusArea === 'users'}
              items={users}
              itemKey={(user) => user.id}
              onHighlight={(user) => setSelectedUserId(user.id)}
              onSubmit={(user) => setModal({kind: 'userConfig', userId: user.id})}
              renderItem={({item, isHighlighted}) => (
                <Box flexDirection="column">
                  <Text color={isHighlighted ? 'cyan' : undefined}>
                    {item.displayName ?? item.email}
                  </Text>
                  <Text color="gray">{item.email}</Text>
                </Box>
              )}
              emptyMessage="No users found"
            />
          </Box>

          <Box flexDirection="column" width="50%">
            <Text color="gray">User details</Text>
            {(() => {
              const user = users.find((u) => u.id === selectedUserId) ?? null;
              if (!user) {
                return <Text color="gray">Select a user to view details.</Text>;
              }
              return (
                <Box flexDirection="column">
                  <Text>Name: {user.displayName ?? user.email}</Text>
                  <Text>Email: {user.email}</Text>
                  <Text>Role: {user.isAdmin ? 'Admin' : 'Member'}</Text>
                  {user.teams && user.teams.length > 0 ? (
                    <>
                      <Text color="gray">Teams:</Text>
                      {user.teams.map((t) => (
                        <Text key={t.id}>- {t.name}</Text>
                      ))}
                    </>
                  ) : (
                    <Text color="gray">No teams</Text>
                  )}
                </Box>
              );
            })()}
          </Box>
        </Box>
      )}

      {working ? <Spinner label="Syncing changes" /> : null}

      <KeyLegend
        items={[
          {key: '←/→', description: 'Switch tabs'},
          {key: 'Tab', description: 'Switch list focus'},
          {key: 'j/k', description: 'Move down/up'},
          {key: 'r', description: 'Refresh directory'},
          {key: 'Enter', description: 'Configure selected item'},
          {key: 't', description: 'Create team (admin)'},
          {key: 'u', description: 'Create user (admin)'}
        ]}
      />

      {modal ? (
        <DirectoryModal
          state={modal}
          onCancel={() => setModal(null)}
          onCreateTeam={handleCreateTeam}
          onCreateUser={handleCreateUser}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onDeleteTeam={async (teamId) => {
            setWorking(true);
            try {
              await deleteTeam(client, teamId);
              notify('Team deleted', 'success');
              await loadDirectory();
            } catch (err) {
              notify(`Failed to delete team: ${(err as Error).message}`, 'error');
            } finally {
              setWorking(false);
              setModal(null);
            }
          }}
          onToggleAdmin={async (userId, next) => {
            setWorking(true);
            try {
              await setAdmin(client, userId, next);
              notify(`User is now ${next ? 'an admin' : 'a member'}`, 'success');
              await loadDirectory();
            } catch (err) {
              notify(`Failed to toggle admin: ${(err as Error).message}`, 'error');
            } finally {
              setWorking(false);
              setModal(null);
            }
          }}
          onDeleteUser={async (userId) => {
            setWorking(true);
            try {
              await deleteUser(client, userId);
              notify('User deleted', 'success');
              await loadDirectory();
            } catch (err) {
              notify(`Failed to delete user: ${(err as Error).message}`, 'error');
            } finally {
              setWorking(false);
              setModal(null);
            }
          }}
          users={users}
          teams={teams}
        />
      ) : null}
    </Box>
  );
};

interface DirectoryModalProps {
  state: NonNullable<ModalState>;
  onCancel: () => void;
  onCreateTeam: (name: string) => void;
  onCreateUser: (name: string, email: string) => void;
  onAddMember: (team: Team, userId: string) => void;
  onRemoveMember: (team: Team, userId: string) => void;
  onDeleteTeam: (teamId: string) => void;
  onToggleAdmin: (userId: string, next: boolean) => void;
  onDeleteUser: (userId: string) => void;
  users: User[];
  teams: Team[];
}

const DirectoryModal: React.FC<DirectoryModalProps> = ({state, onCancel, onCreateTeam, onCreateUser, onAddMember, onRemoveMember, onDeleteTeam, onToggleAdmin, onDeleteUser, users, teams}) => {
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (state.kind === 'createTeam') {
    return <CreateTeamModal onSubmit={onCreateTeam} />;
  }

  if (state.kind === 'createUser') {
    return <CreateUserModal onSubmit={onCreateUser} />;
  }

  if (state.kind === 'addMember') {
    return <AddMemberModal team={state.team} users={users} onSubmit={onAddMember} />;
  }

  if (state.kind === 'teamConfig') {
    return (
      <TeamConfigModal
        team={teams.find((t) => t.id === state.teamId) ?? null}
        users={users}
        onAddMember={(teamId, userId) => {
          const t = teams.find((tt) => tt.id === teamId);
          if (t) onAddMember(t, userId);
        }}
        onRemoveMember={(teamId, userId) => {
          const t = teams.find((tt) => tt.id === teamId);
          if (t) onRemoveMember(t, userId);
        }}
        onDeleteTeam={onDeleteTeam}
      />
    );
  }

  if (state.kind === 'userConfig') {
    return (
      <UserConfigModal
        user={users.find((u) => u.id === state.userId) ?? null}
        onToggleAdmin={onToggleAdmin}
        onDeleteUser={onDeleteUser}
      />
    );
  }

  return null;
};

interface CreateTeamModalProps {
  onSubmit: (name: string) => void;
}

const CreateTeamModal: React.FC<CreateTeamModalProps> = ({onSubmit}) => {
  const [value, setValue] = useState('');

  return (
    <Modal title="Create team">
      <TextInput value={value} onChange={setValue} onSubmit={() => onSubmit(value)} focus />
      <Text color="gray">Enter team name and press Enter.</Text>
    </Modal>
  );
};

interface CreateUserModalProps {
  onSubmit: (name: string, email: string) => void;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({onSubmit}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [field, setField] = useState<'name' | 'email'>('name');

  return (
    <Modal title="Create user">
      <TextInput
        value={name}
        onChange={setName}
        focus={field === 'name'}
        placeholder="Display name"
        onSubmit={() => setField('email')}
      />
      <TextInput
        value={email}
        onChange={setEmail}
        focus={field === 'email'}
        placeholder="Email"
        onSubmit={() => onSubmit(name, email)}
      />
      <Text color="gray">Press Enter to move to the next field, then submit.</Text>
    </Modal>
  );
};

interface AddMemberModalProps {
  team: Team;
  users: User[];
  onSubmit: (team: Team, userId: string) => void;
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({team, users, onSubmit}) => {
  const available = users.filter((user) => !team.members?.some((member) => member.id === user.id));

  return (
    <Modal title={`Add member to ${team.name}`}>
      {available.length === 0 ? (
        <Text color="gray">All users are already members.</Text>
      ) : (
        <List
          items={available}
          itemKey={(u) => u.id}
          onSubmit={(user) => onSubmit(team, user.id)}
          renderItem={({item, isHighlighted}) => (
            <Text color={isHighlighted ? 'cyan' : undefined}>
              {item.displayName ?? item.email} {'<'}{item.email}{'>'}
            </Text>
          )}
          emptyMessage="No available users"
        />
      )}
      <Text color="gray">Enter to add, Esc to cancel</Text>
    </Modal>
  );
};

export default Directory;

interface TeamConfigModalProps {
  team: Team | null;
  users: User[];
  onAddMember: (teamId: string, userId: string) => void;
  onRemoveMember: (teamId: string, userId: string) => void;
  onDeleteTeam: (teamId: string) => void;
}

const TeamConfigModal: React.FC<TeamConfigModalProps> = ({team, users, onAddMember, onRemoveMember, onDeleteTeam}) => {
  const [step, setStep] = useState<'menu' | 'add' | 'remove' | 'confirm-delete'>('menu');
  const [eligible, setEligible] = useState<User[]>([]);

  useEffect(() => {
    if (!team) return;
    if (step === 'add') {
      const available = users.filter((u) => !team.members?.some((m) => m.id === u.id));
      setEligible(available);
    }
    if (step === 'remove') {
      const present = users.filter((u) => team.members?.some((m) => m.id === u.id));
      setEligible(present);
    }
  }, [step, team, users]);

  if (!team) {
    return (
      <Modal title="Team settings">
        <Text color="red">Team not found.</Text>
      </Modal>
    );
  }

  if (step === 'menu') {
    const items = [
      {label: 'Add member', value: 'add' as const},
      {label: 'Remove member', value: 'remove' as const},
      {label: 'Delete team', value: 'delete' as const},
      {label: 'Close', value: 'close' as const}
    ];
    return (
      <Modal title={`Team: ${team.name}`}>
        <Text color="gray">Members: {team.members?.length ?? 0}</Text>
        <Box marginTop={1}>
          <SelectInput<typeof items[number]['value']>
            items={items.map((i) => ({label: i.label, value: i.value}))}
            onSelect={(item) => {
              if (item.value === 'add') setStep('add');
              else if (item.value === 'remove') setStep('remove');
              else if (item.value === 'delete') setStep('confirm-delete');
            }}
          />
        </Box>
        <Text color="gray">Enter to choose, Esc to cancel</Text>
      </Modal>
    );
  }

  if (step === 'add') {
    return (
      <Modal title={`Add member → ${team.name}`}>
        {eligible.length === 0 ? (
          <Text color="gray">All users are already members.</Text>
        ) : (
          <SelectInput<User>
            items={eligible.map((u) => ({label: `${u.displayName ?? u.email} <${u.email}>`, value: u}))}
            onSelect={(item) => onAddMember(team.id, item.value.id)}
          />
        )}
        <Text color="gray">Enter to add, Esc to cancel</Text>
      </Modal>
    );
  }

  if (step === 'remove') {
    return (
      <Modal title={`Remove member → ${team.name}`}>
        {eligible.length === 0 ? (
          <Text color="gray">No members to remove.</Text>
        ) : (
          <SelectInput<User>
            items={eligible.map((u) => ({label: `${u.displayName ?? u.email} <${u.email}>`, value: u}))}
            onSelect={(item) => onRemoveMember(team.id, item.value.id)}
          />
        )}
        <Text color="gray">Enter to remove, Esc to cancel</Text>
      </Modal>
    );
  }

  return (
    <Modal title={`Delete team → ${team.name}`}>
      <Text>Are you sure? This removes the team and its memberships.</Text>
      <Box marginTop={1}>
        <SelectInput<'yes' | 'no'>
          items={[
            {label: 'Yes, delete team', value: 'yes'},
            {label: 'No, cancel', value: 'no'}
          ]}
          onSelect={(item) => {
            if (item.value === 'yes') onDeleteTeam(team.id);
          }}
        />
      </Box>
      <Text color="gray">Enter to confirm, Esc to cancel</Text>
    </Modal>
  );
};

interface UserConfigModalProps {
  user: User | null;
  onToggleAdmin: (userId: string, next: boolean) => void;
  onDeleteUser: (userId: string) => void;
}

const UserConfigModal: React.FC<UserConfigModalProps> = ({user, onToggleAdmin, onDeleteUser}) => {
  if (!user) {
    return (
      <Modal title="User settings">
        <Text color="red">User not found.</Text>
      </Modal>
    );
  }

  const items = [
    {label: user.isAdmin ? 'Demote from admin' : 'Promote to admin', value: 'toggle' as const},
    {label: 'Delete user', value: 'delete' as const},
    {label: 'Close', value: 'close' as const}
  ];

  return (
    <Modal title={`User: ${user.displayName ?? user.email}`}>
      <Box flexDirection="column">
        <Text>Email: {user.email}</Text>
        <Text>Role: {user.isAdmin ? 'Admin' : 'Member'}</Text>
        {user.teams && user.teams.length > 0 ? (
          <>
            <Text color="gray">Teams:</Text>
            {user.teams.map((t) => (
              <Text key={t.id}>- {t.name}</Text>
            ))}
          </>
        ) : (
          <Text color="gray">No teams</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <SelectInput<typeof items[number]['value']>
          items={items.map((i) => ({label: i.label, value: i.value}))}
          onSelect={(item) => {
            if (item.value === 'toggle') onToggleAdmin(user.id, !user.isAdmin);
            if (item.value === 'delete') onDeleteUser(user.id);
          }}
        />
      </Box>
      <Text color="gray">Enter to choose, Esc to cancel</Text>
    </Modal>
  );
};
