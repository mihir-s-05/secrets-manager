import {ApiClient, ApiError} from './client.js';
import {
  deviceStartResponseSchema,
  pollResponseSchema,
  userSchema,
  type DeviceStartResponse,
  type PollResponse
} from '../types/dto.js';

export const startDeviceFlow = async (client: ApiClient): Promise<DeviceStartResponse> => {
  const response = await client.request('/auth/start', {
    method: 'POST',
    schema: deviceStartResponseSchema
  });
  return response.data;
};

export interface PollDeviceArgs {
  deviceCode: string;
  deviceId: string;
}

export type PollDeviceResult =
  | {status: 'PENDING'; retryAfter: number}
  | {status: 'SUCCESS'; payload: PollResponse}
  | {status: 'EXPIRED'; message: string};

export const pollDeviceFlow = async (
  client: ApiClient,
  {deviceCode, deviceId}: PollDeviceArgs,
  pollInterval: number
): Promise<PollDeviceResult> => {
  try {
    const response = await client.request('/auth/poll', {
      method: 'POST',
      body: {deviceCode, deviceId},
      allowedStatuses: [428]
    });

    if (response.status === 428) {
      return {status: 'PENDING', retryAfter: pollInterval};
    }

    // Check if response.data is actually an error object
    if (response.data && typeof response.data === 'object' && 'error' in response.data) {
      const errorData = response.data as {error?: {code?: string; message?: string}};
      throw new ApiError(
        response.status,
        errorData.error?.code ?? 'unknown_error',
        errorData.error?.message ?? 'Unknown error occurred',
        response.data
      );
    }

    // Validate response data matches expected schema
    const parsed = pollResponseSchema.parse(response.data);
    const normalizedPayload: PollResponse = {
      ...parsed,
      user: {
        ...parsed.user,
        teams: parsed.user.teams ?? []
      }
    };
    return {status: 'SUCCESS', payload: normalizedPayload};
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        return {status: 'EXPIRED', message: 'Device code expired. Please restart the login flow.'};
      }
      // For other API errors, include the error message
      throw new Error(`Authentication failed: ${error.message}`);
    }

    // For Zod validation errors, provide a clearer message
    if (error && typeof error === 'object' && 'issues' in error) {
      const zodError = error as {issues: Array<{code: string; path: Array<string | number>; message: string}>};
      const issues = zodError.issues.map((issue) => ({
        code: issue.code,
        expected: issue.path.join('.'),
        received: 'undefined',
        message: issue.message
      }));
      throw new Error(`Invalid response format from server: ${JSON.stringify(issues)}`);
    }

    throw error;
  }
};

export const logout = async (client: ApiClient): Promise<void> => {
  await client.request('/auth/logout', {
    method: 'POST',
    allowedStatuses: [204]
  });
};
