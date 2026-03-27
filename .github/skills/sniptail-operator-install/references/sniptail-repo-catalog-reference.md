# Sniptail Repository Catalog Reference

Use this reference when the user wants to link repositories after installation.

## Preferred Workflow

Use the CLI instead of editing allowlist data by hand.

Examples:

```bash
sniptail repos add my-api --ssh-url git@github.com:org/my-api.git
sniptail repos add payments --ssh-url git@gitlab.com:org/payments.git
sniptail repos add local-tools --local-path /srv/repos/local-tools
sniptail repos list
```

## Key Rules

- use `--ssh-url` for remote repositories
- use `--local-path` for repositories already present on the worker host
- ensure the worker host has SSH access to every remote repository that is added

For GitHub and GitLab requirements, including when to use `--project-id`, use [Repository provider reference](./sniptail-repo-providers-reference.md).

## Useful Follow-Up Commands

```bash
sniptail repos remove my-api
sniptail repos sync-file
sniptail repos sync-run-actions
sniptail repos sync-run-actions --repo my-api
```

## Notes About Allowlist Seeding

`repo_allowlist_path` in `sniptail.worker.toml` can seed an empty catalog on worker startup, but the CLI remains the preferred operator flow for ongoing changes.

If the user explicitly wants file-based seeding, point them to `repo_allowlist_path` after the CLI workflow is explained.
