export type RequestAuth = {
  sessionId: string;
  sessionExpiresAt: string;
  walletIdentityId: string;
  walletAddress: string;
  roles: string[];
  isAdmin: boolean;
  permissions: {
    full_access: boolean;
    manage_agents: boolean;
  };
};
