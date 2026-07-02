/**
 * The auth extension point (DESIGN.md §7): the OSS app ships anonymous (or
 * later OIDC/basic); the SaaS panel plugs its cookie/CSRF session in. Data
 * source and API clients call decorateRequest on every HTTP call.
 */

export interface User {
  name: string;
  email?: string;
}

export interface AuthProvider {
  kind: string;
  getUser(): Promise<User | null>;
  /** Adds credentials (headers, mode) to an outgoing request. */
  decorateRequest(init: RequestInit): RequestInit | Promise<RequestInit>;
  login?(): void;
  logout?(): Promise<void>;
}

export const anonymousAuth: AuthProvider = {
  kind: "anonymous",
  getUser: async () => null,
  decorateRequest: (init) => init,
};
