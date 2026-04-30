export const SENSITIVE_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".npmrc",
  ".docker",
  ".kube",
  ".azure",
  "id_rsa",
  "id_ed25519",
  "credentials",
  ".env",
  ".netrc",
  "token",
  "secret",
];

export const UPSTREAM_PI_PACKAGE_MUTATION_BLOCKLIST = [
  "node_modules/@mariozechner/pi-coding-agent",
];

export const ALLOWED_OUTSIDE = [
  ".pi",
  ".cache/checkouts",
  "node_modules/@mariozechner",
  "node_modules/@davidorex",
  "node_modules/@ifi",
  "node_modules/pi-lens",
  "node_modules/pi-web-access",
  "node_modules/mitsupi",
];
