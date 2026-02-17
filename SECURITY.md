# Security Policy

Sniptail is an automation bot that can access source repositories and post results to chat platforms. We take security issues seriously and appreciate responsible disclosure.

## Supported Versions

Security fixes are applied to:
- `main` (latest)
- The most recent tagged release (if releases exist)

If you are running an older version, please upgrade to the latest release or `main` before reporting, if possible.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, use **GitHub Private Vulnerability Reporting**:

1. Go to the repository’s **Security** tab.
2. Click **Report a vulnerability**.
3. Submit the details privately.

This ensures the issue is visible only to maintainers until a fix is available.

When reporting, please include:
- A clear description of the issue and potential impact
- Reproduction steps (proof-of-concept is helpful)
- Affected components (bot, worker, CLI, install script, etc.)
- Version/commit hash
- Deployment details (OS, Docker, etc.)
- Relevant logs or stack traces (please redact any secrets)

If your report involves exposed credentials (tokens, keys), please **revoke or rotate them immediately**.

## Response Targets

We aim to:
- **Acknowledge** receipt within **3 business days**
- Provide a **status update** within **7 business days**
- Release a fix as soon as reasonably possible, depending on severity and complexity

## Coordinated Disclosure

Please allow us reasonable time to investigate and patch before public disclosure.

If you have a preferred disclosure timeline, please include it in your report.

## Scope

Examples of issues that may qualify:
- Remote code execution, command injection, or sandbox escape
- Authentication or authorization bypass
- Secret exfiltration (tokens, repo contents, chat messages)
- SSRF or unsafe webhook handling
- Supply-chain risks in install scripts or release artifacts
- Unsafe default configurations leading to compromise

Out of scope (generally):
- Vulnerabilities in third-party services without demonstrated impact on Sniptail
- Issues requiring already-compromised infrastructure with no additional Sniptail impact
- Denial-of-service requiring unrealistic traffic levels

## Security Notes for Deployments

Sniptail deployments typically involve sensitive credentials. We strongly recommend:

- Use least-privilege GitHub/GitLab tokens
- Restrict which repositories Sniptail can access
- Store secrets securely (and never commit `.env` files)
- Run workers in isolated environments where possible
- Treat generated patches/PRs as untrusted until reviewed

## Safe Harbor

We support good-faith security research. If you:
- Avoid privacy violations and service disruption
- Only access data you own or have permission to test
- Report issues responsibly and privately

We will not pursue legal action related to your research.
