## Error handling

- Avoid silent failures: Do not add error handling that will cause the code to fail silently. If I ask for an intended behavior, I want to fail if the code is not adhering to that behavior instead of failing silently.

## Skills
A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.
### Available skills
- cylp-clp-branch-and-bound: Use CyLP's Python interface to CLP/CBC for LP relaxation solving and branch-and-bound workflows that incrementally add/remove branch constraints and reoptimize with warm starts (startFinishOptions and basis snapshots) instead of solving from scratch. Use when implementing or debugging custom CyLP branch-and-bound loops, CLP resolve behavior, NodeCompare/cut hooks, or basis-aware reoptimization. (file: /Users/siddjain/.codex/skills/cylp-clp-branch-and-bound/SKILL.md)
- massive-api-downloader: Download data from Massive (formerly Polygon) REST APIs and save it locally. Use when requests involve pulling market data, reference data, snapshots, aggregates, trades, quotes, or news from https://api.massive.com with an API key from MASSIVE_API_KEY. (file: /Users/siddjain/.codex/skills/massive-api-downloader/SKILL.md)
- nemo-cluster-runbook: Submit, monitor, and debug NeMo and NeMo-Skills jobs on configured SLURM clusters (cw-dfw, oci-iad, eos, hsg, lax, ord), including SSH alias usage, command templates (skills_verl_submit_addons.py, nemo_rl_sft.py, convert_ckpt_to_hf.py, run_cmd_wrapper.py, ns generate), and exact remote log path resolution. Use when working in /Users/siddjain/workspace/skills_* repositories or when asked where main, server, and sandbox logs are located. (file: /Users/siddjain/.codex/skills/nemo-cluster-runbook/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /Users/siddjain/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /Users/siddjain/.codex/skills/.system/skill-installer/SKILL.md)
### How to use skills
- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
