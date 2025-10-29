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
import {sessionStore} from '../state/session.js';
import {
  addTeamMember,
  createTeam,
  createUser,
  fetchTeams,
  fetchUsers,
  removeTeamMember,
  setAdmin
} from '../api/directory.js';
import type {Team, User} from '../types/dto.js';

interface AdminAction {
  id: string;
  label: string;
  description: string;
}

type AdminModal =
  | {kind: 'createTeam'}
  | {kind: 'createUser'}
  | {kind: 'addMember'}
  | {kind: 'removeMember'}
  | {kind: 'toggleAdmin'}
  | {kind: 'viewAs'}
  | null;

const Admin: React.FC = () => {
  const {client, notify, session, setEditing, setEscapeHandler} = useAppServices();
  const router = useRouter();

  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [modal, setModal] = useState<AdminModal>(null);

  const isAdmin = session.user?.isAdmin ?? false;

  useEffect(() => {
    if (!isAdmin) {
      notify('Administrator privileges required.', 'error');
      router.replace('HOME');
      return;
    }
  }, [isAdmin, notify, router]);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const [teamResult, userResult] = await Promise.all([fetchTeams(client), fetchUsers(client)]);
      setTeams(teamResult);
      setUsers(userResult);
    } catch (err) {
      notify(`Unable to load directory: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [client, notify]);

  useEffect(() => {
    setEditing(!!modal);
    setEscapeHandler(() => {
      if (modal) {
        setModal(null);
        return true;
      }
      router.pop();
      return true;
    });
    loadDirectory().catch(() => undefined);
    return () => {
      setEscapeHandler(null);
    };
  }, [loadDirectory, modal, router, setEditing, setEscapeHandler]);

  const actions: AdminAction[] = useMemo(() => {
    const base: AdminAction[] = [
      {id: 'create-user', label: 'Create user', description: 'Invite a new user to the org'},
      {id: 'create-team', label: 'Create team', description: 'Spin up a new team'},
      {id: 'add-member', label: 'Add team member', description: 'Add an existing user to a team'},
      {id: 'remove-member', label: 'Remove team member', description: 'Remove a user from a team'},
      {id: 'toggle-admin', label: 'Toggle admin', description: 'Promote or demote an admin'}
    ];
    if (session.viewAsUserId) {
      base.push({id: 'exit-view-as', label: 'Exit view-as', description: 'Return to your admin view'});
    } else {
      base.push({id: 'view-as', label: 'View as user', description: 'Preview app as a specific user'});
    }
    return base;
  }, [session.viewAsUserId]);

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case 'create-user':
        setModal({kind: 'createUser'});
        break;
      case 'create-team':
        setModal({kind: 'createTeam'});
        break;
      case 'add-member':
        setModal({kind: 'addMember'});
        break;
      case 'remove-member':
        setModal({kind: 'removeMember'});
        break;
      case 'toggle-admin':
        setModal({kind: 'toggleAdmin'});
        break;
      case 'view-as':
        setModal({kind: 'viewAs'});
        break;
      case 'exit-view-as':
        sessionStore.update({viewAsUserId: undefined, viewAsUserName: undefined});
        notify('Exited view-as mode', 'success');
        break;
      default:
        break;
    }
  };

  const handleCreateTeam = async (name: string) => {
    if (!name.trim()) {
      notify('Team name is required.', 'error');
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

  const handleAddMember = async (teamId: string, userId: string) => {
    setWorking(true);
    try {
      await addTeamMember(client, teamId, userId);
      notify('Member added to team', 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to add member: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    setWorking(true);
    try {
      await removeTeamMember(client, teamId, userId);
      notify('Member removed from team', 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to remove member: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleToggleAdmin = async (userId: string, next: boolean) => {
    setWorking(true);
    try {
      const updated = await setAdmin(client, userId, next);
      notify(`${updated.displayName ?? updated.email} is now ${updated.isAdmin ? 'an admin' : 'a member'}`, 'success');
      await loadDirectory();
    } catch (err) {
      notify(`Failed to toggle admin: ${(err as Error).message}`, 'error');
    } finally {
      setWorking(false);
      setModal(null);
    }
  };

  const handleViewAs = (user: User) => {
    sessionStore.update({viewAsUserId: user.id, viewAsUserName: user.displayName ?? user.email});
    notify(`Viewing as ${user.displayName ?? user.email}`, 'success');
    setModal(null);
  };

  useInput((input: string, key: Key) => {
    if (modal) {
      if (key.escape) {
        setModal(null);
      }
      return;
    }

    if (input === 'r') {
      loadDirectory().catch(() => undefined);
    }
  });

  if (loading) {
    return <Spinner label="Loading admin data" />;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="cyan">Admin console</Text>
      <List
        focusId="admin-actions"
        items={actions}
        itemKey={(action) => action.id}
        onSubmit={(action) => handleAction(action.id)}
        renderItem={({item, isHighlighted}) => (
          <Box flexDirection="column">
            <Text color={isHighlighted ? 'cyan' : undefined}>{item.label}</Text>
            <Text color="gray">{item.description}</Text>
          </Box>
        )}
      />
      {working ? <Spinner label="Working" /> : null}
      <KeyLegend
        items={[
          {key: 'Enter', description: 'Run selected action'},
          {key: 'r', description: 'Refresh directory'},
          {key: 'Esc', description: 'Close modal/back'}
        ]}
      />

      {modal ? (
        <AdminModal
          state={modal}
          teams={teams}
          users={users}
          onCancel={() => setModal(null)}
          onCreateTeam={handleCreateTeam}
          onCreateUser={handleCreateUser}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
          onToggleAdmin={handleToggleAdmin}
          onViewAs={handleViewAs}
        />
      ) : null}
    </Box>
  );
};

interface AdminModalProps {
  state: NonNullable<AdminModal>;
  teams: Team[];
  users: User[];
  onCancel: () => void;
  onCreateTeam: (name: string) => void;
  onCreateUser: (name: string, email: string) => void;
  onAddMember: (teamId: string, userId: string) => void;
  onRemoveMember: (teamId: string, userId: string) => void;
  onToggleAdmin: (userId: string, next: boolean) => void;
  onViewAs: (user: User) => void;
}

const AdminModal: React.FC<AdminModalProps> = ({state, teams, users, onCancel, onCreateTeam, onCreateUser, onAddMember, onRemoveMember, onToggleAdmin, onViewAs}) => {
  useInput((input: string, key: Key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (state.kind === 'createTeam') {
    return <CreateTeamAdminModal onSubmit={onCreateTeam} />;
  }

  if (state.kind === 'createUser') {
    return <CreateUserAdminModal onSubmit={onCreateUser} />;
  }

  if (state.kind === 'addMember' || state.kind === 'removeMember') {
    return (
      <MembershipModal
        teams={teams}
        users={users}
        mode={state.kind}
        onAddMember={onAddMember}
        onRemoveMember={onRemoveMember}
      />
    );
  }

  if (state.kind === 'toggleAdmin') {
    return <ToggleAdminModal users={users} onSubmit={onToggleAdmin} />;
  }

  if (state.kind === 'viewAs') {
    return <ViewAsModal users={users} onSubmit={onViewAs} />;
  }

  return null;
};

const CreateTeamAdminModal: React.FC<{onSubmit: (name: string) => void}> = ({onSubmit}) => {
  const [value, setValue] = useState('');
  return (
    <Modal title="Create team">
      <TextInput value={value} onChange={setValue} onSubmit={() => onSubmit(value)} focus />
      <Text color="gray">Enter team name and press Enter.</Text>
    </Modal>
  );
};

const CreateUserAdminModal: React.FC<{onSubmit: (name: string, email: string) => void}> = ({onSubmit}) => {
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

interface MembershipModalProps {
  teams: Team[];
  users: User[];
  mode: 'addMember' | 'removeMember';
  onAddMember: (teamId: string, userId: string) => void;
  onRemoveMember: (teamId: string, userId: string) => void;
}

const MembershipModal: React.FC<MembershipModalProps> = ({teams, users, mode, onAddMember, onRemoveMember}) => {
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(teams[0] ?? null);
  const [step, setStep] = useState<'team' | 'user'>('team');

  const eligibleUsers = useMemo(() => {
    if (!selectedTeam) return users;
    if (mode === 'addMember') {
      return users.filter((user) => !selectedTeam.members?.some((member) => member.id === user.id));
    }
    return users.filter((user) => selectedTeam.members?.some((member) => member.id === user.id));
  }, [mode, selectedTeam, users]);

  const submit = (userId: string) => {
    if (!selectedTeam) return;
    if (mode === 'addMember') {
      onAddMember(selectedTeam.id, userId);
    } else {
      onRemoveMember(selectedTeam.id, userId);
    }
  };

  return (
    <Modal title={mode === 'addMember' ? 'Add team member' : 'Remove team member'}>
      {step === 'team' ? (
        <SelectInput<Team>
          items={teams.map((team) => ({label: team.name, value: team}))}
          onSelect={(item) => {
            setSelectedTeam(item.value);
            setStep('user');
          }}
        />
      ) : eligibleUsers.length === 0 ? (
        <Text color="gray">No matching users.</Text>
      ) : (
        <SelectInput<User>
          items={eligibleUsers.map((user) => ({
            label: `${user.displayName ?? user.email} <${user.email}>`,
            value: user
          }))}
          onSelect={(item) => submit(item.value.id)}
        />
      )}
      <Text color="gray">Esc to cancel</Text>
    </Modal>
  );
};

const ToggleAdminModal: React.FC<{users: User[]; onSubmit: (userId: string, next: boolean) => void}> = ({users, onSubmit}) => (
  <Modal title="Toggle admin">
    <SelectInput<User>
      items={users.map((user) => ({
        label: `${user.displayName ?? user.email} (${user.isAdmin ? 'admin' : 'member'})`,
        value: user
      }))}
      onSelect={(item) => onSubmit(item.value.id, !item.value.isAdmin)}
    />
    <Text color="gray">Esc to cancel</Text>
  </Modal>
);

const ViewAsModal: React.FC<{users: User[]; onSubmit: (user: User) => void}> = ({users, onSubmit}) => (
  <Modal title="View as user">
    <SelectInput<User>
      items={users.map((user) => ({
        label: `${user.displayName ?? user.email} <${user.email}>`,
        value: user
      }))}
      onSelect={(item) => onSubmit(item.value)}
    />
    <Text color="gray">Esc to cancel</Text>
  </Modal>
);

export default Admin;
