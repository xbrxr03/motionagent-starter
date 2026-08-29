# MotionAgent Repository Architecture

This repository is the standalone **free starter** distribution.

MotionAgent's product surfaces are:

- `xbrxr03/motionagent`: canonical development source; not a customer distribution.
- `xbrxr03/motionagent-starter`: this repository; core CLI/engine plus exactly the free `ui-mate` and `talking-head` packs.
- `motionagent-paid-addon`: a non-standalone overlay that adds exactly five packs: `grove-editorial`, `fun-money`, `saas-motion`, `workflow-poster`, and `fly-motion`.

Do not copy paid packs into this repository. Core changes should originate in the development repository, then be deliberately ported here with customer-safe assets and tests. A release check for this repository must continue to report only the two free packs before any paid overlay is applied.

Temporary worktrees, render outputs, and private reference material are not product repositories.
