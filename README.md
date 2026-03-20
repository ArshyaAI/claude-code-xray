# Continuous Factory

Multi-repo autonomous build system. Spawns Claude Code agents in git worktrees overnight, each running a full sprint pipeline: think, plan, build, review, test, ship, reflect.

## Quickstart

```bash
git clone git@github.com:ArshyaAI/continuous-factory.git
cd continuous-factory
chmod +x install.sh bin/*.sh
./install.sh
# Edit ~/.factory/config.sh with your repos, then:
factory-dispatch.sh --all
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.
