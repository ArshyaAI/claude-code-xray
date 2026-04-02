# Claude Code X-Ray GitHub Action

Gate your PRs on Claude Code setup quality. The action runs X-Ray on your repo,
posts a score comment on the PR, and fails the check if the score is below your
threshold.

## Quick Start

```yaml
# .github/workflows/xray.yml
name: X-Ray
on: [pull_request]

jobs:
  xray:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ArshyaAI/claude-code-xray/.github/actions/xray@main
        with:
          min-score: 70
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input          | Default               | Description                                     |
| -------------- | --------------------- | ----------------------------------------------- |
| `min-score`    | `0`                   | Minimum overall score to pass (0 = always pass) |
| `min-safety`   | `0`                   | Minimum safety dimension score to pass          |
| `comment`      | `true`                | Post results as a PR comment                    |
| `github-token` | `${{ github.token }}` | Token for posting PR comments                   |

## Outputs

| Output       | Description                                         |
| ------------ | --------------------------------------------------- |
| `score`      | Overall X-Ray score (0-100)                         |
| `pass`       | Whether the scan passed thresholds (`true`/`false`) |
| `dimensions` | JSON object of dimension scores                     |

## Examples

### Gate on safety only

```yaml
- uses: ArshyaAI/claude-code-xray/.github/actions/xray@main
  with:
    min-safety: 60
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Score without blocking

```yaml
- uses: ArshyaAI/claude-code-xray/.github/actions/xray@main
  with:
    min-score: 0 # never fails
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Use the score in later steps

```yaml
- uses: ArshyaAI/claude-code-xray/.github/actions/xray@main
  id: xray
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Log score
  run: echo "X-Ray score is ${{ steps.xray.outputs.score }}"

- name: Custom threshold logic
  if: steps.xray.outputs.score < 50
  run: echo "::warning::Low X-Ray score"
```

### Silent mode (no PR comment)

```yaml
- uses: ArshyaAI/claude-code-xray/.github/actions/xray@main
  with:
    min-score: 70
    comment: "false"
```

## PR Comment

When `comment: true` (the default), the action posts a table like this on the PR:

> **Score: 73/100** (min: 70)
>
> | Dimension  | Score              | Checks |
> | ---------- | ------------------ | ------ |
> | Safety     | :green_circle: 85  | 5/6    |
> | Capability | :yellow_circle: 50 | 3/5    |
> | Automation | :green_circle: 75  | 4/5    |
> | Efficiency | :green_circle: 79  | 6/8    |

Previous X-Ray comments are automatically replaced to keep the PR clean.
