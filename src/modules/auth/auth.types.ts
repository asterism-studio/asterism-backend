export interface VerifiedUser {
  id: string
  email: string | null
}

export interface AuthContext {
  userId: string
  email: string | null
}

export interface AuthVerifier {
  getUser(accessToken: string): Promise<VerifiedUser | null>
}
