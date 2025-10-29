const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const USER_EMAILS_URL = 'https://api.github.com/user/emails';

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'secrets-manager-backend',
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in (data as Record<string, unknown>)
      ? (data as Record<string, unknown>).error
      : response.statusText;
    throw new Error(String(message));
  }

  return data;
}

export type DeviceCodeResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type AccessTokenResult =
  | { status: 'pending'; interval?: number }
  | { status: 'success'; accessToken: string };

export type GithubUserProfile = {
  id: string;
  login: string;
  name?: string | null;
  email: string;
};

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const data = await fetchJson<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>(DEVICE_CODE_URL, {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      scope: 'read:user user:email'
    })
  });

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval
  };
}

export async function exchangeDeviceCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  deviceCode: string;
}): Promise<AccessTokenResult> {
  const data = await fetchJson<{
    access_token?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  }>(ACCESS_TOKEN_URL, {
    method: 'POST',
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      device_code: params.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });

  if (data.error === 'authorization_pending') {
    return { status: 'pending', interval: data.interval };
  }

  if (data.error === 'slow_down') {
    const interval = typeof data.interval === 'number' ? data.interval : undefined;
    return { status: 'pending', interval };
  }

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  const accessToken = data.access_token;
  if (!accessToken) {
    throw new Error('GitHub response missing access token');
  }

  return { status: 'success', accessToken };
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUserProfile> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const [user, emails] = await Promise.all([
    fetchJson<{
      id: number | string;
      login: string;
      name?: string | null;
    }>(USER_URL, { headers: authHeaders }),
    fetchJson<Array<{ email: string; primary: boolean; verified: boolean }>>(USER_EMAILS_URL, {
      headers: authHeaders
    })
  ]);

  const primaryEmail =
    emails.find((email) => email.primary && email.verified) ??
    emails.find((email) => email.primary) ??
    emails.find((email) => email.verified) ??
    emails[0];

  if (!primaryEmail?.email) {
    throw new Error('Unable to resolve primary GitHub email');
  }

  return {
    id: String(user.id),
    login: user.login,
    name: user.name,
    email: primaryEmail.email
  };
}
