import React, {createContext, useContext, useMemo, useReducer} from 'react';

export type RouteName =
  | 'HOME'
  | 'LOGIN'
  | 'SECRETS'
  | 'SECRET_VIEW'
  | 'SECRET_EDIT'
  | 'DIRECTORY'
  | 'ADMIN'
  | 'SETTINGS';

export interface RouteParamsMap {
  HOME: Record<string, never>;
  LOGIN: Record<string, never>;
  SECRETS: Record<string, never>;
  SECRET_VIEW: {secretId: string};
  SECRET_EDIT: {secretId?: string; mode: 'create' | 'edit'};
  DIRECTORY: {tab?: 'users' | 'teams'};
  ADMIN: Record<string, never>;
  SETTINGS: Record<string, never>;
}

export type Route<T extends RouteName = RouteName> = {
  name: T;
  params?: RouteParamsMap[T];
};

interface RouterState {
  stack: Route[];
}

type RouterAction =
  | {type: 'PUSH'; route: Route}
  | {type: 'POP'}
  | {type: 'REPLACE'; route: Route}
  | {type: 'RESET'; route: Route};

export interface RouterContextValue {
  stack: Route[];
  route: Route;
  push: <T extends RouteName>(name: T, params?: RouteParamsMap[T]) => void;
  pop: () => void;
  replace: <T extends RouteName>(name: T, params?: RouteParamsMap[T]) => void;
  reset: <T extends RouteName>(name: T, params?: RouteParamsMap[T]) => void;
}

const initialRoute: Route = {name: 'HOME'};

export const RouterContext = createContext<RouterContextValue | undefined>(undefined);

const reducer = (state: RouterState, action: RouterAction): RouterState => {
  switch (action.type) {
    case 'PUSH':
      return {stack: [...state.stack, action.route]};
    case 'POP': {
      if (state.stack.length <= 1) {
        return state;
      }
      return {stack: state.stack.slice(0, -1)};
    }
    case 'REPLACE': {
      const next = [...state.stack.slice(0, -1), action.route];
      return {stack: next};
    }
    case 'RESET':
      return {stack: [action.route]};
    default:
      return state;
  }
};

export interface RouterProviderProps {
  initial?: Route;
  children: React.ReactNode;
}

export const RouterProvider: React.FC<RouterProviderProps> = ({initial = initialRoute, children}) => {
  const [state, dispatch] = useReducer(reducer, {stack: [initial]});

  const value = useMemo<RouterContextValue>(() => {
    const route = state.stack[state.stack.length - 1];
    return {
      stack: state.stack,
      route,
      push: (name, params) => dispatch({type: 'PUSH', route: {name, params}}),
      pop: () => dispatch({type: 'POP'}),
      replace: (name, params) => dispatch({type: 'REPLACE', route: {name, params}}),
      reset: (name, params) => dispatch({type: 'RESET', route: {name, params}})
    };
  }, [state.stack]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

export const useRouter = (): RouterContextValue => {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
};

export interface RouteDefinition {
  name: RouteName;
  title: string;
  description: string;
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
}

export const ROUTES: RouteDefinition[] = [
  {name: 'HOME', title: 'Home', description: 'Overview and quick actions'},
  {name: 'LOGIN', title: 'Login', description: 'Authenticate via device code'},
  {name: 'SECRETS', title: 'Secrets', description: 'Browse secrets', requiresAuth: true},
  {name: 'SECRET_VIEW', title: 'Secret Detail', description: 'View a secret', requiresAuth: true},
  {name: 'SECRET_EDIT', title: 'Edit Secret', description: 'Create or update secrets', requiresAuth: true},
  {name: 'DIRECTORY', title: 'Directory', description: 'Users and teams', requiresAuth: true},
  {name: 'ADMIN', title: 'Admin', description: 'Administer users, teams, roles', requiresAdmin: true},
  {name: 'SETTINGS', title: 'Settings', description: 'Server, session, cache'}
];
