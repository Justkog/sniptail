# Sniptail Repository Provider Reference

Use this reference when the user needs repository-provider-specific guidance for GitHub or GitLab.

## Scope

This reference explains provider behavior.

Use the other references for adjacent concerns:

- [Operator preflight reference](./sniptail-preflight-reference.md) for raw checks
- [Repository catalog reference](./sniptail-repo-catalog-reference.md) for CLI workflow
- [Install and local runtime reference](./sniptail-install-local-reference.md) for single-machine bring-up
- [Split deployment reference](./sniptail-split-deployment-reference.md) for multi-machine bring-up

## GitHub

### Clone-only access

- the worker needs SSH access to the repository
- no GitHub API variable is required just to clone and inspect the repo

Example:

```bash
sniptail repos add my-api --ssh-url git@github.com:org/my-api.git
```

### Pull request support

- set `GITHUB_API_TOKEN`
- keep SSH access to the repository on the worker

Use `GITHUB_API_TOKEN` when Sniptail needs to create GitHub pull requests.

## GitLab

### Clone-only access

- the worker needs SSH access to the repository
- `--project-id` is required even for clone-only access (the GitLab provider always validates its presence)
- no GitLab API variables (`GITLAB_BASE_URL` / `GITLAB_TOKEN`) are needed just to clone and inspect the repo

Example:

```bash
sniptail repos add payments --ssh-url git@gitlab.com:org/payments.git --project-id 12345
```

### Merge request support

- set `GITLAB_BASE_URL`
- set `GITLAB_TOKEN`
- keep SSH access to the repository on the worker
- add the repository with `--project-id`

Examples:

```bash
sniptail repos add payments --ssh-url git@gitlab.com:org/payments.git --project-id 12345
sniptail repos add internal-api --ssh-url git@code.example.com:platform/internal-api.git --project-id 6789
```

### Self-managed GitLab note

Do not rely on provider inference for self-managed GitLab hosts.

If the repository should be treated as GitLab for merge requests, pass `--project-id` even when the SSH URL does not contain the word `gitlab`.

## Provider Summary

- GitHub clone-only:
  - SSH access only
- GitHub pull request support:
  - `GITHUB_API_TOKEN`
- GitLab clone-only:
  - SSH access only
  - `--project-id` required
- GitLab merge request support:
  - `GITLAB_BASE_URL`
  - `GITLAB_TOKEN`
  - `--project-id`

## Troubleshooting

- GitHub PR creation fails:
  - verify `GITHUB_API_TOKEN`
- GitLab merge request creation fails:
  - verify both `GITLAB_BASE_URL` and `GITLAB_TOKEN`
  - verify the repository was added with `--project-id`
- A self-managed GitLab repository is not behaving like GitLab:
  - re-add or update it with `--project-id`
