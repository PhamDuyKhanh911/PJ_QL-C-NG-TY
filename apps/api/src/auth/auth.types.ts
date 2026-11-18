export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  displayName: string;
  permissions: string[];
  scopes: Array<{ type: string; id: string | null }>;
}

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  email: string;
}

